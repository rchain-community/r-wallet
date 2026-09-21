// Bootstrap the rgov governance contract set onto a chain, and record the resulting master
// read-capability URI — the value the editor's governance snippets need as their `ReadcapURI`.
//
// Why this exists: the master URI is not a constant, it is the product of deploying the contract
// set on a particular chain. The original toolchain (`github.com/rchain-community/rgov`,
// Jakefile.js) deployed contracts in dependency order, recorded each resulting `rho:id`, and
// substituted dependencies into dependents. A master URI recorded for one chain (e.g. the old
// Scala rhobot shard) means nothing on a fresh chain, which is why the governance snippets stall
// waiting for `GetMe` and return `[]`.
//
// Usage:
//   npx tsx scripts/bootstrap-rgov.ts --dry-run                 show the plan; no network calls
//   npx tsx scripts/bootstrap-rgov.ts --node <url>              deploy and record
//   npx tsx scripts/bootstrap-rgov.ts --node <url> --force      redeploy everything
//
// Options: --node <url> (or RNODE_URL), --key <hex> (or RNODE_KEY), --rgov <dir>, --dry-run,
//          --force. Default rgov checkout: /tmp/rgov.
//
// Writes scripts/rgov-bootstrap.<host>.json — the manifest of deploy ids and registry URIs.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { deploy as rnode_deploy } from "../src/utils/rnode";
import { get_account_from_private_key } from "../src/utils/blockchain";
import { formatRhoResult } from "../src/api/rho-json";
import { PLAYGROUND_ACCOUNTS } from "../src/config/playground";
import type { NamedWallet } from "../src/utils/utils";

const HEREDIR = path.dirname(fileURLToPath(import.meta.url));
const DEVNET_DEPLOYER_KEY = "a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76";

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const NODE = arg("node") ?? process.env.RNODE_URL ?? "http://localhost:40403";
const IS_LOCAL = /localhost|127\.0\.0\.1/.test(NODE);
const KEY = arg("key")
    ?? process.env.RNODE_KEY
    ?? (IS_LOCAL ? DEVNET_DEPLOYER_KEY : PLAYGROUND_ACCOUNTS[0].privKey);
let rgov_dir = arg("rgov") ?? "/tmp/rgov";

const HOST = NODE.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]/g, "_");
const MANIFEST = path.join(HEREDIR, `rgov-bootstrap.${HOST}.json`);

// The deployment order from the original Jakefile.js:
//   contractTask('kudos.rho'); contractTask('inbox.rho'); contractTask('directory.rho');
//   contractTask('memberIdGovRev.rho', ['inbox.rho', 'directory.rho']); contractTask('Issue.rho');
// `Community.rho` is commented out upstream (superseded by the member directory), so it is not
// deployed here either. Echo and Log/mq fill two slots of the master directory's member list.
interface Step {
    name: string;
    file: string;
    /** Names of earlier steps whose URIs must be substituted into this source. */
    deps?: string[];
    note?: string;
}

const STEPS: Step[] = [
    { name: "kudos", file: "rholang/core/Kudos.rho" },
    { name: "inbox", file: "rholang/core/Inbox.rho" },
    { name: "directory", file: "rholang/core/Directory.rho" },
    {
        name: "roll",
        file: "rholang/core/memberIdGovRev.rho",
        deps: ["directory", "inbox"],
        note: "the member directory / roll; imports directory.rho and inbox.rho by URI",
    },
    { name: "issue", file: "rholang/core/Issue.rho" },
];

/**
 * The master directory takes seven members positionally; this is the order in
 * bootstrap/create-master-contract-directory-testnet.rho. `Echo` (Echo.rho) and `Log` (mq.rho)
 * define classes but never call `rho:registry:insertArbitrary`, so they publish no URI — and
 * nothing reads those two keys back (no consumer in rgov's `src/actions`, rgov's `rholang/`, or the
 * wallet's snippets). Their slots therefore reuse an already-registered class so the directory's
 * lookups and writes succeed; the entries are write-only placeholders. The alternative — making
 * those two files self-registering — means editing upstream contracts to add a registration
 * epilogue, which buys nothing while no caller reads the keys.
 */
const SLOT_ALIASES: Record<string, string> = { echo: "directory", log: "directory" };
const MASTER_MEMBERS = ["directory", "echo", "inbox", "issue", "kudos", "roll", "log"];

function read_source(rel: string): string {
    const p = path.join(rgov_dir, rel);
    if (!fs.existsSync(p)) throw new Error(`missing contract source: ${p}`);
    return fs.readFileSync(p, "utf-8");
}

/**
 * The contract sources come from the rgov repo. The default is a /tmp clone, which does not survive
 * a reboot, so fall back to a cached clone rather than failing at the first deploy.
 */
function resolve_rgov(): void {
    if (fs.existsSync(path.join(rgov_dir, "rholang/core/Inbox.rho"))) return;

    const cache = path.join(HEREDIR, ".rgov-cache");
    if (!fs.existsSync(path.join(cache, "rholang/core/Inbox.rho"))) {
        console.log(`contracts not found at ${rgov_dir} — cloning rchain-community/rgov into ${cache}\n`);
        const res = spawnSync(
            "git",
            ["clone", "--depth", "1", "https://github.com/rchain-community/rgov", cache],
            { stdio: "inherit" }
        );
        if (res.status !== 0) {
            throw new Error(
                `could not clone rgov (exit ${res.status}); pass --rgov <dir> to point at a checkout`
            );
        }
    }

    rgov_dir = cache;
}

/** Substitute a dependency's URI into a `rho:id:...` placeholder, left to right. */
function substitute_deps(source: string, deps: string[], uris: Record<string, string>): string {
    let out = source;
    for (const dep of deps) {
        const uri = uris[dep];
        if (!uri) throw new Error(`no URI recorded for dependency "${dep}"`);

        const marker = `match ("import", "./${dep}.rho", \`rho:id:...\`)`;
        if (!out.includes(marker)) throw new Error(`dependency marker for "${dep}" not found`);
        out = out.replace(marker, `match ("import", "./${dep}.rho", \`${uri}\`)`);
    }
    return out;
}

/** The first `rho:id:...` anywhere in a deploy result is the contract's registry URI. */
function extract_uri(expr: unknown): string | null {
    let found: string | null = null;
    const walk = (v: unknown) => {
        if (found || v == null) return;
        if (typeof v === "string") {
            if (v.startsWith("rho:id:")) found = v;
            return;
        }
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (typeof v === "object") { Object.values(v).forEach(walk); }
    };
    walk(expr);
    return found;
}

/**
 * `rho:registry:lookup` replies with the stored value alone (fixed as C18 in r-node), so consuming
 * it is a plain `lookup!(uri, *ch) | for (X <- ch) { X!(…) }` — no destructuring, and the upstream
 * master-directory template is deployed verbatim. See `spec/API-SCHEMA.md` in r-node for the
 * standard this depends on.
 */

function load_manifest(): Record<string, string> {
    if (!fs.existsSync(MANIFEST)) return {};
    return JSON.parse(fs.readFileSync(MANIFEST, "utf-8")) as Record<string, string>;
}

function save_manifest(uris: Record<string, string>) {
    fs.writeFileSync(MANIFEST, JSON.stringify(uris, null, 2) + "\n");
}

async function main() {
    resolve_rgov();

    const acct = await get_account_from_private_key(KEY);
    if (!acct) throw new Error("could not derive a wallet from the deploy key");

    const wallet: NamedWallet & { privKey: string } = {
        name: "rgov-bootstrap",
        ...acct,
        privKey: acct.privKey,
    };

    console.log(`node:     ${NODE}`);
    console.log(`rgov:     ${rgov_dir}`);
    console.log(`deployer: ${acct.revAddr}`);
    console.log(`manifest: ${path.relative(process.cwd(), MANIFEST)}`);
    if (DRY_RUN) console.log("(dry run — no deploys will be sent)\n");

    const uris = load_manifest();
    for (const [k, v] of Object.entries(uris)) {
        console.log(`already recorded: ${k.padEnd(12)} ${v}`);
    }
    console.log();

    for (const step of STEPS) {
        if (uris[step.name] && !FORCE) {
            console.log(`skip   ${step.name.padEnd(12)} ${uris[step.name]}`);
            continue;
        }

        let term = read_source(step.file);
        if (step.deps) {
            term = substitute_deps(term, step.deps, uris);
        }

        if (DRY_RUN) {
            console.log(`plan   ${step.name.padEnd(12)} ${step.file} (${term.length} bytes)`);
            if (step.deps) console.log(`         substitutes: ${step.deps.join(", ")}`);
            // Dry runs cannot invent URIs, so downstream substitution is untestable past here.
            uris[step.name] = uris[step.name] ?? `<pending:${step.name}>`;
            continue;
        }

        const res = await rnode_deploy(NODE, wallet, term, 5_000_000);
        if (res.error) {
            console.error(`FAIL   ${step.name.padEnd(12)} ${res.error}`);
            process.exit(1);
        }

        const uri = extract_uri(res.expr);
        if (!uri) {
            console.error(`FAIL   ${step.name.padEnd(12)} deployed but returned no rho:id`);
            console.error(`       result was: ${formatRhoResult(res.expr)}`);
            process.exit(1);
        }

        uris[step.name] = uri;
        save_manifest(uris);
        console.log(`ok     ${step.name.padEnd(12)} ${uri}`);
    }

    // The master directory: a directory binding each class, published as the master read-cap.
    if (uris.master && !FORCE) {
        console.log(`\nmaster URI already recorded: ${uris.master}`);
        return;
    }

    // Resolve each positional slot to a URI: a registered class, or the alias for the two
    // write-only slots.
    const slot_uri = (member: string): string => {
        const source = SLOT_ALIASES[member] ?? member;
        return uris[source] ?? "";
    };

    const missing = MASTER_MEMBERS.filter(m => !slot_uri(m) || slot_uri(m).startsWith("<pending"));
    if (missing.length > 0 && !DRY_RUN) {
        console.log(`\ncannot build the master directory yet — missing URIs for: ${missing.join(", ")}`);
        console.log("re-run without --dry-run to deploy the members first.");
        return;
    }

    const master_source = path.join(rgov_dir, "bootstrap/create-master-contract-directory-testnet.rho");
    if (!fs.existsSync(master_source)) throw new Error(`missing ${master_source}`);

    // Replace the seven hardcoded member URIs positionally with the ones we just deployed.
    let template = fs.readFileSync(master_source, "utf-8");
    let replaced = 0;
    template = template.replace(/`rho:id:[0-9a-z]+`/g, () => {
        const member = MASTER_MEMBERS[replaced++];
        return `\`${slot_uri(member)}\``;
    });
    if (replaced !== MASTER_MEMBERS.length) {
        throw new Error(`expected ${MASTER_MEMBERS.length} member URIs in the master directory, found ${replaced}`);
    }

    // The template is deployed verbatim: `rho:registry:lookup` replies with the stored value alone
    // (the schema standard), so the upstream `for (X <- ch)` consumption is already correct.

    if (DRY_RUN) {
        console.log(`\nplan   master       bootstrap/create-master-contract-directory-testnet.rho`);
        console.log(`         members: ${MASTER_MEMBERS.join(", ")}`);
        console.log(`plan   feature      rholang/feature/MemberDirectory.rho (registers GetMe/SendThem)`);
        return;
    }

    const res = await rnode_deploy(NODE, wallet, template, 5_000_000);
    if (res.error) {
        console.error(`FAIL   master       ${res.error}`);
        process.exit(1);
    }

    const master = extract_uri(res.expr);
    if (!master) {
        console.error(`FAIL   master       deployed but returned no rho:id`);
        console.error(`       result was: ${formatRhoResult(res.expr)}`);
        process.exit(1);
    }

    uris.master = master;
    save_manifest(uris);

    console.log(`\nmaster read-capability URI: ${master}`);

    // The feature deploy REGISTERS the master's `GetMe`/`SendThem` methods
    // (rholang/feature/MemberDirectory.rho: MCAwrite!("GetMe", bundle+{*getMe}, …)). It must run
    // after the master directory exists, and from the SAME deployer key — the admin write cap is
    // published on `@[*deployerId, "MasterContractAdmin"]`, and the deployer identity is derived
    // from the signing key. Deploy-all ordered this last for exactly this reason; skipping it is
    // why `M!("GetMe", *ch)` can answer `Nil` and every dependent action returns `[]`.
    if (!uris.feature || FORCE) {
        const feature = read_source("rholang/feature/MemberDirectory.rho");
        const res = await rnode_deploy(NODE, wallet, feature, 5_000_000, []);
        if (res.error) {
            console.error(`FAIL   feature      ${res.error}`);
            process.exit(1);
        }
        uris.feature = "deployed";
        save_manifest(uris);
        console.log(`ok     feature      rholang/feature/MemberDirectory.rho (registers GetMe/SendThem)`);
    } else {
        console.log(`skip   feature      already deployed`);
    }

    console.log(`\nPut this in src/config/master-uri.ts for this network, then re-record the`);
    console.log(`governance goldens: npm run test:output -- --node ${NODE} --record`);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
