// Evidence probe for claimWithInbox, whose pane is `[]` where a value is expected.
//
// The snippet's term can come up empty in two very different ways, and the pane cannot tell them
// apart: an earlier hop may never fire (a channel nothing writes to), or it may fire and the
// contract may *refuse* — `memberIdGovRev.rho`'s `claim` answers `(false, "revAddr not
// registered" | "revAddr must match deployer")`, and `setup` only pattern-matches `@(true, …)`, so a
// refusal leaves `setup` unable to reply and the deploy returns `[]` with no error anywhere.
//
// So this stages the same chain of hops with a `stdout` marker at each one, and calls `claim`
// directly (printing its reply, whatever it is) before falling through to `setup`. Read the markers
// back with:
//   docker logs devnet-bootstrap 2>&1 | grep -o 'MARK-[A-Z-]*' | sort -u
//
// Run: npx tsx scripts/probe-claim-inbox.mts
import { snippet_apply } from "../src/modules/wallet/deploy/snippets";
import { deploy } from "../src/utils/rnode";
import { get_account_from_private_key } from "../src/utils/blockchain";
import { formatRhoResult } from "../src/api/rho-json";
import { master_uri_for_url } from "../src/config/master-uri";
import type { NamedWallet } from "../src/utils/utils";

const NODE = "http://localhost:40403";
const KEY = "a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76";

const acct = await get_account_from_private_key(KEY);
if (!acct) throw new Error("could not derive the deploy key");
const wallet: NamedWallet & { privKey: string } = { name: "probe", ...acct, privKey: acct.privKey };

const run = async (label: string, term: string) => {
    console.log(`\n=== ${label}`);
    const res = await deploy(NODE, wallet, term, 1_000_000);
    console.log(`  err : ${res.error}`);
    console.log(`  pane: ${formatRhoResult(res.expr)?.replace(/\n/g, " ")}`);
};

// The prerequisite the snippet itself depends on: the deployer's dictionary, at
// `@[*deployerId, "dictionary"]`, is published by newInbox — but only when its GetMe exchange
// succeeds, and it returns `[]` (not an error) when the read capability it is handed does not
// resolve. The sweep runs newInbox earlier in the same session with the editor's own arguments for
// exactly that reason, so the probe must pass the same one.
const MASTER = master_uri_for_url(NODE);
if (!MASTER) throw new Error(`no master URI configured for ${NODE} (src/config/master-uri.ts)`);

await run(
    `newInbox (prerequisite — publishes the deployer's dictionary, readcap=${MASTER})`,
    snippet_apply("newInbox", [MASTER])
);

// The same hops as claimWithInbox, marked, with `claim` called directly so its reply is visible.
const staged = (myGovRevAddr: string): string => {
    const code =
    "[myGovRevAddr] => {\n" +
    "  new\n" +
    "  deployId(`rho:rchain:deployId`),\n" +
    "  deployerId(`rho:rchain:deployerId`),\n" +
    "  stdout(`rho:io:stdout`),\n" +
    "  probeInbox,\n" +
    "  rollCh,\n" +
    "  selfCh,\n" +
    "  claimCh,\n" +
    "  setupCh\n" +
    "  in {\n" +
    '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
    '      stdout!(["MARK-DICT-OK"]) |\n' +
    '      MCA!("Roll", *rollCh)\n' +
    "    } |\n" +
    "    for (Roll <- rollCh) {\n" +
    '      stdout!(["MARK-ROLL-OK"]) |\n' +
    '      Roll!("make", Set(myGovRevAddr), *selfCh) |\n' +
    '      for (@{"self": self, ..._} <- selfCh) {\n' +
    '        stdout!(["MARK-MAKE-OK"]) |\n' +
    '        @self!("claim", myGovRevAddr, {"inbox": *probeInbox}, *claimCh) |\n' +
    "        for (@claimReply <- claimCh) {\n" +
    '          stdout!(["MARK-CLAIM-REPLY", claimReply]) |\n' +
    '          @self!("setup", myGovRevAddr, *setupCh) |\n' +
    "          for (@setupReply <- setupCh) {\n" +
    '            stdout!(["MARK-SETUP-REPLY", setupReply]) |\n' +
    '            deployId!(["inbox claimed", setupReply])\n' +
    "          }\n" +
    "        }\n" +
    "      }\n" +
    "    }\n" +
    "  }\n" +
    "}";

    // The editor sends a snippet wrapped as `match [args…] { <lambda> }` (snippet_apply) — a bare
    // `[x] => {…}` is not a rholang term, which is why this has to be wrapped too.
    return `match [${JSON.stringify(myGovRevAddr)}] {\n`
        + code.split("\n").map(l => `  ${l}`).join("\n")
        + "\n}";
};

// The address the harness fills for a `walletRevAddr` field, and the one `claim` requires to equal
// the deployer's own derived REV address.
await run(`staged claim (addr=${acct.revAddr})`, staged(acct.revAddr));

// Control: the snippet as shipped, so the probe and the suite are answering the same question.
await run("claimWithInbox (as shipped)", snippet_apply("claimWithInbox", [acct.revAddr]));
