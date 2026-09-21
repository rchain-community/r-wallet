// Integration test for the editor's "Output" window: every contract (snippet) must produce the
// right text in the pane.
//
// For each snippet this builds the SAME term the editor builds (snippet_apply over arguments
// filled the way Deploy.tsx fills them), runs it through the app's own seam
// (src/utils/rnode.ts), and compares what the pane would display — `output_text(err,
// formatRhoResult(expr))`, the same rule the UI uses — against a committed golden.
//
// Usage:
//   npm run test:output                        compare against the goldens (default: devnet)
//   npm run test:output -- --record            (re)record goldens for the target
//   npm run test:output -- --node <url>        target another node (e.g. https://rnodeapi.rhobot.net)
//   npm run test:output -- --key <hex>         deploy with this private key
//   npm run test:output -- --strict            also fail when a contract's output is an error
//
// Goldens live in scripts/goldens/output/<host>/<snippet>.txt and hold the pane text verbatim
// after normalisation of everything run-dependent (REV addresses -> <ADDR>, registered rho:ids ->
// <RHO-ID>, deploy signatures/block hashes -> <HEX>, a free-variable dump tail -> <elided>).
// The same normaliser runs on both the record and the compare path.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    snippets,
    snippet_apply,
    snippet_meta,
    common_field_defaults,
    type Snippet,
} from "../src/modules/wallet/deploy/snippets";
import { master_uri_for_url } from "../src/config/master-uri";
import { formatRhoJson, formatRhoResult, output_text } from "../src/api/rho-json";
import { get_account_from_private_key } from "../src/utils/blockchain";
import { deploy as rnode_deploy, explore as rnode_explore } from "../src/utils/rnode";
import { PLAYGROUND_ACCOUNTS } from "../src/config/playground";
import type { NamedWallet } from "../src/utils/utils";

// The devnet's funded deployer (tools/devnet.sh: DEPLOYER_PRIV = VALIDATOR_PRIV[0]).
const DEVNET_DEPLOYER_KEY = "a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76";

const HEREDIR = path.dirname(fileURLToPath(import.meta.url));

// How a snippet is exercised.
//   explore  - read-only, runs on an isolated fork so it cannot disturb the chain.
//   deploy   - the real deploy path.
//   excluded - not run; `note` must say why, and the reason is visible in the run output.
type Op = "explore" | "deploy" | "excluded";

interface Case {
    op: Op;
    /** Overrides for argument fields the editor would leave empty. */
    args?: Record<string, string>;
    note?: string;
    /**
     * Reason this contract legitimately returns nothing (`[]`). Anything not listed here MUST
     * return a value: an empty result is a failure, because that is the symptom this suite exists
     * to catch (the governance contracts returning `[]` while their flows silently stall).
     */
    returns_nothing?: string;
}

// `explore-deploy` does not bind the deploy-time system channels, so any contract that reads
// `rho:rchain:deployId` / `rho:rchain:deployerId` fails under explore with
// "No value set for `rho:rchain:deployId`" — an artefact of the harness, not of the contract.
// Such contracts are automatically run through the deploy path instead.
function needs_deploy(name: keyof typeof snippets): boolean {
    const code = snippets[name]?.code ?? "";
    return code.includes("rho:rchain:deployId") || code.includes("rho:rchain:deployerId");
}

function effective_op(name: string): Op {
    const declared = CASES[name].op;
    if (declared !== "explore") return declared;
    return needs_deploy(name as keyof typeof snippets) ? "deploy" : "explore";
}

// Every snippet must be classified here — the sweep fails on a snippet that is not, so a newly
// added contract cannot silently escape coverage.
const CASES: Record<string, Case> = {
    blank: { op: "explore", returns_nothing: "an empty term sends nothing to the result channel" },
    // Read an account this suite never spends from, so the recorded balance does not drift as a
    // side effect of the deploy cases in the same run.
    checkBalance: { op: "explore", args: { myGovRevAddr: PLAYGROUND_ACCOUNTS[1].revAddr } },
    transfer: {
        op: "excluded",
        note: "moves REV and therefore mutates balances; covered end-to-end by npm run test:api",
    },
    sequencialLooping: { op: "explore" },

    // The governance/master-contract family: each of these reads or writes state created by the
    // master read-capability, which a bare node does not have. They are still run, and the golden
    // records exactly what the pane shows for them on this node.
    newInbox: { op: "explore" },
    peekInbox: { op: "explore" },
    receiveFromInbox: { op: "explore" },
    createInboxandCastVote: {
        op: "explore",
        note: "empty snippet body — a placeholder in the snippet table",
        returns_nothing: "the snippet body is empty, so the term produces no value",
    },
    newChat: { op: "explore" },
    sendChat: { op: "explore" },
    readChat: {
        op: "excluded",
        note: "waits on a listener and never returns, so it can only be tested with a timeout",
    },
    newBallot: { op: "explore" },
    castBallot: { op: "explore" },
    newIssue: { op: "explore" },
    addVoterToIssue: { op: "explore" },
    addGroupToIssue: { op: "explore" },
    castVote: { op: "explore" },
    displayVote: { op: "explore" },
    delegateVote: { op: "explore" },
    tallyVotes: { op: "explore" },
    share: { op: "explore" },
    sendMail: { op: "explore" },
    newGroup: { op: "explore" },
    joinGroup: { op: "explore" },
    addMember: { op: "explore" },
    newMemberDirectory: {
        op: "explore",
        note: "references undeclared channels (trace/MCA/deployerId), so it cannot compile",
    },
    makeMint: { op: "explore" },

    // Self-contained: these produce a real result on a bare node.
    helloWorld: {
        op: "explore",
        returns_nothing: "the contract writes to rho:io:stdout, not to the result channel",
    },
    getRoll: { op: "explore" },
    peekKudos: { op: "explore", note: "references an undeclared channel (KudosReg)" },
    awardKudos: { op: "explore", note: "references an undeclared channel (KudosReg)" },
    claimWithInbox: { op: "explore" },
    checkRegistration: { op: "explore" },
    lookupURI: {
        op: "explore",
        note: "needs a rho:id that is actually registered on the target node",
    },
    createURI: { op: "explore" },
    doit: { op: "explore" },
    attachmentEcho: {
        op: "deploy",
        note: "attachments cannot ride explore-deploy, so this needs the deploy path",
    },
    towers: { op: "explore" },
};

// Referenced by the deploy case; kept here so the attachment is spelled out.
const ATTACHMENTS = ["deadbeef"];

let failures = 0;
function check(cond: boolean, label: string) {
    if (cond) console.log(`  PASS  ${label}`);
    else {
        console.error(`  FAIL  ${label}`);
        failures++;
    }
}

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const RECORD = process.argv.includes("--record");
const STRICT = process.argv.includes("--strict");
const TIMEOUT_MS = Number(arg("timeout") ?? 30000);

const NODE = arg("node") ?? process.env.RNODE_URL ?? "http://localhost:40403";
const IS_LOCAL = /localhost|127\.0\.0\.1/.test(NODE);
const KEY = arg("key")
    ?? process.env.RNODE_KEY
    ?? (IS_LOCAL ? DEVNET_DEPLOYER_KEY : PLAYGROUND_ACCOUNTS[0].privKey);

const HOST = NODE.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]/g, "_");
const GOLDEN_DIR = path.join(HEREDIR, "goldens", "output", HOST);

// Everything run-dependent that appears in a pane result: REV addresses, freshly registered
// rho:ids, deploy signatures/block hashes (a deploy id is a ~140-char DER hex string, so the run
// must be matched whole rather than in 64-char chunks), and the tail of a rholang free-variable
// dump, which echoes the built term and is enormous.
function normalise(text: string): string {
    const cleaned = text
        .replace(/1111[1-9A-HJ-NP-Za-km-z]{30,}/g, "<ADDR>")
        .replace(/rho:id:[0-9a-z]+/g, "<RHO-ID>")
        .replace(/[0-9a-f]{32,}/g, "<HEX>")
        .replace(/Par \{[\s\S]*/, "Par { <elided> }");

    // A result is a Par — an unordered multiset — so the order of a multi-value result differs
    // between runs (sequencialLooping was recorded descending and came back ascending). Sort the
    // top level so an order change is not a failure while every value stays pinned. Errors and
    // dumps are not JSON, so they pass through untouched.
    try {
        const value = JSON.parse(cleaned);
        if (!Array.isArray(value)) return cleaned;

        const sorted = [...value].sort((a, b) => {
            if (typeof a === "number" && typeof b === "number") return a - b;
            return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
        });
        return formatRhoJson(sorted);
    } catch {
        return cleaned;
    }
}

// Arguments as the editor fills them (Deploy.tsx set_snippet): the snippet's own defaults, then
// the shared defaults, then the MasterURI constant or the active wallet's address. Anything the
// editor would leave empty gets a deterministic placeholder so the contract still compiles.
function editor_args(
    snippet: Snippet,
    meta_defaults: Record<string, string>,
    wallet_addr: string,
    overrides: Record<string, string> = {}
): string[] {
    return snippet.fields.map(field => {
        if (field.name in overrides) return overrides[field.name];

        const defaulted = meta_defaults[field.name] ?? common_field_defaults[field.name];
        if (defaulted !== undefined) return defaulted;

        // MasterURI fields take the governance master URI for this target, as the editor does;
        // an unbootstrapped network yields "" and the contract will report that for itself.
        if (field.type === "MasterURI") return master_uri_for_url(NODE);
        if (field.type === "uri") return master_uri_for_url(NODE) || "rho:id:testnet";
        if (field.type === "walletRevAddr") return wallet_addr;
        if (field.type === "number") return "1";
        if (field.type === "set") return "1, 2";
        return "test";
    });
}

// What the pane would show, plus which side of `output_text` produced it. The flag matters:
// client errors are returned as quoted strings, so they parse as valid JSON and a JSON-parse
// check alone would score a failure as a success.
interface PaneOutput {
    text: string;
    errored: boolean;
}

async function run_term(name: string, term: string): Promise<PaneOutput> {
    if (effective_op(name) === "deploy") {
        const acct = await get_account_from_private_key(KEY);
        if (!acct) return { text: "could not derive a wallet from the deploy key", errored: true };

        const wallet: NamedWallet & { privKey: string } = {
            name: "output-test",
            ...acct,
            privKey: acct.privKey,
        };
        const res = await rnode_deploy(NODE, wallet, term, 500000, ATTACHMENTS);
        return { text: output_text(res.error, formatRhoResult(res.expr)), errored: !!res.error };
    }

    const res = await rnode_explore(NODE, term);
    return { text: output_text(res.error, formatRhoResult(res.expr)), errored: !!res.error };
}

// Some contracts only complete when a message arrives (inbox/chat/ballot readers), so a bare run
// would hang. Bound each case and record the non-return explicitly instead.
async function run_bounded(name: string, term: string): Promise<PaneOutput> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<PaneOutput>(resolve => {
        timer = setTimeout(
            () => resolve({
                text: `TIMEOUT after ${TIMEOUT_MS}ms (the contract did not return)`,
                errored: true,
            }),
            TIMEOUT_MS
        );
    });

    try {
        return await Promise.race([run_term(name, term), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

// The governance handshake, exercised as a unit: the prerequisite that registers the deployer's
// lockers, then a dependent action that can only work if the handshake completed.
//
// Every governance snippet checked in isolation returns either `[]` or an error when the master is
// dead, which reads like "nothing to assert". This case is what makes a dead master unambiguously
// red: `newChat` cannot return a value unless `newInbox` genuinely reached the master first.
async function check_governance_handshake(wallet_addr: string): Promise<void> {
    const master = master_uri_for_url(NODE);
    if (!master) {
        check(
            false,
            `governance handshake: no master URI configured for ${HOST} — `
                + `run scripts/bootstrap-rgov.ts and record it in src/config/master-uri.ts`
        );
        return;
    }

    const metadefaults = (name: keyof typeof snippets) => snippet_meta[name]?.defaults ?? {};

    // 1. Prerequisite: newInbox claims a member inbox and publishes the deployer's lockers.
    const inbox_term = snippet_apply(
        "newInbox",
        editor_args(snippets.newInbox, metadefaults("newInbox"), wallet_addr)
    );
    const inbox = await run_bounded("newInbox", inbox_term);
    check(
        !inbox.errored && normalise(inbox.text).trim() !== "[]",
        `governance handshake: newInbox returns a value (${JSON.stringify(inbox.text).slice(0, 100)})`
    );

    // 2. Dependent action: reads the lockers the prerequisite just published.
    const chat_term = snippet_apply(
        "newChat",
        editor_args(snippets.newChat, metadefaults("newChat"), wallet_addr, { channel: "output-test" })
    );
    const chat = await run_bounded("newChat", chat_term);
    check(
        !chat.errored && normalise(chat.text).trim() !== "[]",
        `governance handshake: newChat returns a value (${JSON.stringify(chat.text).slice(0, 100)})`
    );
}

async function main() {
    console.log(`node:    ${NODE}`);
    console.log(`goldens: ${path.relative(process.cwd(), GOLDEN_DIR)}${RECORD ? "  (recording)" : ""}\n`);

    const acct = await get_account_from_private_key(KEY);
    if (!acct) throw new Error("could not derive a wallet from the deploy key");
    console.log(`wallet:  ${acct.revAddr}\n`);

    // No snippet may escape the sweep.
    const unclassified = (Object.keys(snippets) as Array<keyof typeof snippets>)
        .filter(k => !(k in CASES));
    check(unclassified.length === 0, `every snippet is classified (unclassified: ${unclassified.join(", ") || "none"})`);

    if (RECORD) fs.mkdirSync(GOLDEN_DIR, { recursive: true });

    let ran = 0;
    let json_ok = 0;
    let errored: string[] = [];
    let excluded: string[] = [];

    for (const name of Object.keys(CASES)) {
        const c = CASES[name];
        const golden_path = path.join(GOLDEN_DIR, `${name}.txt`);

        if (c.op === "excluded") {
            excluded.push(`${name} (${c.note})`);
            check(!!c.note, `${name}: excluded with a documented reason`);
            continue;
        }

        const snippet = snippets[name as keyof typeof snippets];
        if (!snippet) {
            check(false, `${name}: snippet exists`);
            continue;
        }

        const meta_defaults = snippet_meta[name as keyof typeof snippets]?.defaults ?? {};
        const term = snippet_apply(name as keyof typeof snippets, editor_args(snippet, meta_defaults, acct.revAddr, c.args));

        const op = effective_op(name);
        const op_label = op === CASES[name].op ? op : `${op} (forced: reads deploy-time channels)`;

        let pane: PaneOutput;
        try {
            pane = await run_bounded(name, term);
        } catch (err) {
            check(false, `${name}: ran without throwing (${(err as Error).message.slice(0, 120)})`);
            continue;
        }
        ran++;

        const output = normalise(pane.text);

        // Which side of the pane rule produced this — the result JSON, or an error/status.
        if (pane.errored) errored.push(name);
        else json_ok++;

        // An empty result is only acceptable where it is the contract's actual behaviour.
        const is_empty = output.trim() === "[]";
        if (is_empty) {
            check(
                !!c.returns_nothing,
                `${name} [${op_label}] returns a value`
                    + (c.returns_nothing ? ` — allowed to return nothing: ${c.returns_nothing}` : " (got [])")
            );
        }

        if (RECORD) {
            fs.writeFileSync(golden_path, output);
            check(true, `${name} [${op_label}] recorded`);
            continue;
        }

        if (!fs.existsSync(golden_path)) {
            check(false, `${name}: golden missing — run with --record against ${NODE}`);
            continue;
        }

        const expected = fs.readFileSync(golden_path, "utf-8");
        const ok = expected === output;
        check(ok, `${name} [${op_label}] matches golden${ok ? "" : `\n        got: ${JSON.stringify(output)}\n        want: ${JSON.stringify(expected)}`}`);
    }

    console.log("\n--- governance handshake ---");
    await check_governance_handshake(acct.revAddr);

    console.log(`\n${ran} run (${json_ok} showing JSON, ${errored.length} showing an error/status), ${excluded.length} excluded`);
    if (errored.length > 0) {
        console.log(`showing an error/status: ${errored.join(", ")}`);
    }
    if (excluded.length > 0) {
        for (const e of excluded) console.log(`excluded: ${e}`);
    }

    if (STRICT && errored.length > 0) {
        check(false, `--strict: ${errored.length} contract(s) produced no result JSON`);
    }

    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
