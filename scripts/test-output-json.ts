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
//
// A case fails when its pane does not show the committed golden, when it shows an error/status
// instead of JSON (unless the case declares `error_ok`), and when it returns nothing without a
// declared `returns_nothing`. A case whose contract the node's own genesis install makes unable to
// answer declares `blocked_by` instead — with a tripwire in the other direction: it fails the moment
// it starts answering, so the declaration cannot outlive the defect. Recording is refused for a case
// that timed out, did not compile, or returned nothing it does not legitimately return.
//
// Goldens live in scripts/goldens/output/<host>/<snippet>.txt and hold the pane text verbatim
// after normalisation of everything run-dependent (REV addresses -> <ADDR>, registered rho:ids ->
// <RHO-ID>, deploy signatures/block hashes -> <HEX>, a free-variable dump tail -> <elided>).
// The same normaliser runs on both the record and the compare path.
//
// A case may additionally declare `volatile_numbers` when its result is chain state that moves under
// the run's own feet (a balance that falls with every deploy's gas, a counter that climbs once per
// run). Every number leaf is then written as <INT>, so the golden pins the shape, the keys and that
// a value is present but not the drifting value — which makes such a golden deliberately not valid
// JSON. One clean run is not evidence for these: the compare must pass twice in a row.

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
import { exploreDeployRaw } from "../src/api/client";
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
    /**
     * The pane legitimately shows an error/status instead of JSON for this case (a node that is
     * known not to host the contract, for instance). Must say why. Nothing sets this on the devnet:
     * an error there is a failure, which is the whole point of the run.
     */
    error_ok?: string;
    /**
     * The snippet's own source says this term must never be deployed (a `// … use EXPLORE` marker).
     * Asserted, not trusted: `needs_deploy` promotes on a substring match over the code text, so a
     * future snippet that merely *mentions* a deploy-time channel would otherwise be turned into a
     * chain write without anyone deciding that.
     */
    explore_only?: string;
    /**
     * Reason this case's numeric leaves must not be pinned. Some results are chain state that moves
     * under the suite's own feet: a REV balance falls as every deploy spends gas, and a kudos
     * counter climbs once per run. A golden recorded as a number is stale by the next run, and
     * re-recording it would make the suite assert whatever the last run happened to see. Declared,
     * every number leaf of the JSON result is written as the bare token `<INT>`: the golden still
     * pins the shape, the keys and that a value is present, but not the drifting value. Must say
     * why — an exemption without a reason becomes a resting place.
     */
    volatile_numbers?: string;
    /**
     * Reason this case is *blocked on the node*, not on the wallet: the contract is installed in a
     * way that cannot answer, so the pane shows `[]` until someone else changes the chain. Distinct
     * from `returns_nothing` — that says the contract's own design returns nothing, this says the
     * node's genesis install makes an answer impossible, and the two must not be confused, because
     * only one of them is a defect. The declaration is a **tripwire**, not an excuse: the moment the
     * pane shows a value, this case fails and demands the flag's removal, so it cannot outlive the
     * defect it documents. A blocked case records no golden — `[]` here is the symptom, and
     * committing it would encode the bug as the contract.
     */
    blocked_by?: string;
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
    // Reads `args.myGovRevAddr`. On a remote host that is a playground account this suite never
    // spends from; on the devnet `main()` points it at the deployer instead — the account that pays
    // for every deploy in the run — so the balance necessarily falls as the run proceeds.
    checkBalance: {
        op: "explore",
        args: { myGovRevAddr: PLAYGROUND_ACCOUNTS[1].revAddr },
        volatile_numbers: "the REV balance falls by the gas of every deploy in this run, so a "
            + "recorded number is stale by the next case",
    },
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
    newMemberDirectory: { op: "explore" },
    makeMint: { op: "explore" },

    // Self-contained: these produce a real result on a bare node.
    helloWorld: {
        op: "explore",
        returns_nothing: "the contract writes to rho:io:stdout, not to the result channel",
    },
    getRoll: { op: "explore" },
    // awardKudos runs before peekKudos deliberately: on a chain that has never awarded, the kudos
    // map is `{}` — no counter exists to read — so peekKudos' golden would be `{}` on a fresh chain
    // and `{"test": N}` on every chain after one award, i.e. it would pin run *history* rather than
    // the contract. Awarding first makes the pair stable in both directions (measured: peek reads
    // `{}` before the first award on a fresh chain).
    awardKudos: {
        op: "explore",
        volatile_numbers: "the counter it returns is the value after this run's award, so it climbs "
            + "by one on every run",
    },
    peekKudos: {
        op: "explore",
        volatile_numbers: "the counter it reads is chain state that every run's awardKudos bumps, "
            + "so a recorded count is stale by the next run",
    },
    // Not a wallet defect: measured, every hop of this snippet fires and `memberIdGovRev.rho`'s
    // `claim` answers `(false, "revAddr must match deployer")` — it derives the deployer's address
    // from `rho:rchain:deployerId` **as bound in its own install deploy**, and genesis signs the
    // `roll` class with the fixed key blake2b256("rnode/genesis/rgov/roll") (pubkey 04012a28…,
    // address 11112JQ5MP17oXzXTeqcXPk1bP9WiVU5SokMUpc3B3vwE8jCRULssj), so no other deployer can
    // ever satisfy it. `setup` only matches `@(true, …)`, so the refusal leaves the pane empty with
    // no error. Evidence: scripts/probe-claim-inbox.mts (markers) and scripts/probe-deployer-address.mts
    // (both derivations and both balances). Cannot be fixed in the wallet — `claim` is the chain's
    // only membership gate, and a snippet that claimed without it would be lying.
    claimWithInbox: {
        op: "explore",
        blocked_by: "genesis installs the roll class with a fixed key, so claim compares against that "
            + "key's address and refuses every other deployer (node-side; see AGENTS.md)",
    },
    checkRegistration: { op: "explore" },
    lookupURI: {
        op: "explore",
        note: "needs a rho:id that is actually registered on the target node",
        explore_only: "the snippet's own source says `// always use EXPLORE`",
    },
    createURI: { op: "explore" },
    doit: { op: "explore" },
    attachmentEcho: {
        op: "deploy",
        note: "attachments cannot ride explore-deploy, so this needs the deploy path",
    },
    towers: {
        op: "explore",
        explore_only: "the snippet's own source says `// towers of hanoi - use EXPLORE`",
    },
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
//
// `mask_ints` additionally blanks every number leaf of a JSON result as the bare token `<INT>`. It
// is a parameter rather than a second function so that the golden written at record time and the
// text compared at run time are literally the same expression — see `volatile_numbers` on `Case`.
function normalise(text: string, mask_ints = false): string {
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

        // Sort BEFORE masking, because a masked leaf is a string: masking first would push every
        // numeric pair into the lexicographic branch below and the sort would silently stop
        // happening. Two equal elements compare `0`, not "greater" — a comparator that calls them
        // greater is inconsistent, and `sort()` is then free to return any order at all.
        const sorted = [...value].sort((a, b) => {
            if (typeof a === "number" && typeof b === "number") return a - b;
            const ka = JSON.stringify(a);
            const kb = JSON.stringify(b);
            return ka < kb ? -1 : ka > kb ? 1 : 0;
        });

        if (!mask_ints) return formatRhoJson(sorted);
        return formatRhoJson(mask_number_leaves(sorted)).replace(MASKED_INT_RENDERED, "<INT>");
    } catch {
        return cleaned;
    }
}

// The value a masked number leaf carries until it is rendered. The NUL wrapper is what makes the
// substitution above provable: `formatRhoJson` escapes a NUL as `\u0000`, so the escaped form can
// only have come from this mask — never from a value the contract returned, even one that happens
// to read `<INT>`. The golden is therefore not valid JSON when it carries the token, by design:
// nothing re-parses a golden (it is read and compared as text at the end of the sweep).
const MASKED_INT = "\u0000<INT>\u0000";
const MASKED_INT_RENDERED = /"\\u0000<INT>\\u0000"/g;

// Every number leaf, keys untouched. Deliberately not a size or integrality test: every rholang
// integer is integral, a kudos counter is `6`, and any threshold low enough to mask `6` also masks
// `displayVote`'s `"proposals": [1, 2]`, `castBallot`'s `1` and `createURI`'s `1`. What scopes the
// mask is the per-case `volatile_numbers`, not a cleverer predicate.
function mask_number_leaves(value: unknown): unknown {
    if (typeof value === "number") return MASKED_INT;
    if (Array.isArray(value)) return value.map(mask_number_leaves);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, mask_number_leaves(v)])
        );
    }
    return value;
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

async function run_term(name: string, term: string, op?: Op): Promise<PaneOutput> {
    if ((op ?? effective_op(name)) === "deploy") {
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
async function run_bounded(name: string, term: string, op?: Op): Promise<PaneOutput> {
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
        return await Promise.race([run_term(name, term, op), timeout]);
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

/**
 * The response schema the wallet depends on, asserted from the consumer side.
 *
 * Each case pins a *node* contract rather than a contract's behaviour, so a node regression is
 * caught here (in the app that consumes it) as well as in the node's own conformance tests. A
 * failure in this group is a node-side finding, not a wallet bug: the message names the register
 * entry so the two repos stay legible together.
 */
async function check_process_api_schema(): Promise<void> {
    // 1. `rho:registry:lookup(uri, ret)` sends the STORED VALUE ALONE on `ret`.
    //    Oracle: the genesis `Registry.rho` contract, whose `lookup` forwards
    //    `TreeHashMap!("get", …)` (legacy/casper/src/main/resources/Registry.rho:397-401), with its
    //    recorded output at legacy/rholang/examples/tut-registry.rho:8,42-47.
    //    `spec/AUDIT.md` C18 — a wrapper (`(uri, value)`) binds the pair to a name, making the send
    //    *name* and the send below is a silent no-op. Every oracle-era client is written this way.
    const schema_lookup =
        'new target, ins(`rho:registry:insertArbitrary`), look(`rho:registry:lookup`),\n' +
        '    deployId(`rho:rchain:deployId`), uCh, lCh, rCh in {\n' +
        '  contract target(@x, ret) = { ret!(["target-got", x]) } |\n' +
        '  ins!(bundle+{*target}, *uCh) |\n' +
        '  for (@uri <- uCh) {\n' +
        '    look!(uri, *lCh) |\n' +
        '    for (T <- lCh) {\n' +
        '      T!("schema", *rCh) |\n' +
        '      for (@r <- rCh) { deployId!(["reached-target", r]) }\n' +
        '    }\n' +
        '  }\n' +
        '}';
    const lookup = await run_bounded("schema:registry-lookup", schema_lookup, "deploy");
    check(
        /reached-target/.test(lookup.text),
        "schema: rho:registry:lookup replies with the stored value alone, so "
            + "`for (X <- ch) { X!(…) }` reaches the registered contract "
            + "(node: spec/AUDIT.md C18 — the reply must not be wrapped as (uri, value))"
    );

    // 2. `rho:block:data` replies with **three** values: `(blockNumber, sender, timestamp)`.
    //    This is a deliberate, documented extension of the oracle (which sends two —
    //    legacy/.../SystemProcesses.scala:355-361), specified in docs/src/rholang/reference.md:93
    //    and consumed in full by the node's own genesis vault (RevVault.rho:207-209 binds
    //    `@blockNumber, @sender, @timestamp`). So this is NOT the defect it first looked like: a
    //    *legacy* two-name consumer stalls, but the node cannot send two without breaking RevVault
    //    and therefore REV. Asserted here at the documented arity so a silent change to either
    //    shape is caught from the consumer side.
    const schema_block_data =
        'new bd(`rho:block:data`), deployId(`rho:rchain:deployId`), ret in {\n' +
        '  bd!(*ret) |\n' +
        '  for (@blockNumber, @sender, @timestamp <- ret) {\n' +
        '    deployId!(["block-data-3", blockNumber, sender, timestamp])\n' +
        '  }\n' +
        '}';
    const block_data = await run_bounded("schema:block-data", schema_block_data, "deploy");
    check(
        /block-data-3/.test(block_data.text),
        "schema: rho:block:data replies with three values (blockNumber, sender, timestamp), "
            + "as documented and as the genesis vault consumes"
    );

    // 3. A **partial map pattern** must match a dictionary with more entries than the pattern names.
    //    This is the behaviour the entire governance family rests on: `MemberDirectory.rho:15` gates
    //    its body on `@{"read": *MCAread, ..._}` against a three-key map, and every locker read in
    //    the snippets is the same shape. Node-side defect C20: the remainder never absorbs a map
    //    entry, so a pattern matches only when the map has exactly as many entries as the pattern —
    //    the failure is silent, because an unmatched `for` is not an error. Asserted here because the
    //    wallet's own correctness depends on it and nothing else pins it.
    const schema_partial_map =
        'new cap, deployId(`rho:rchain:deployId`), ch in {\n' +
        '  ch!({"grant": *cap, "read": *cap, "write": *cap}) |\n' +
        '  for (@{"read": *m, ..._} <<- ch) { deployId!(["partial-map-3key", "matched"]) }\n' +
        '}';
    const partial_map = await run_bounded("schema:partial-map", schema_partial_map, "deploy");
    check(
        /partial-map-3key/.test(partial_map.text),
        "schema: a partial map pattern matches a dictionary with extra keys "
            + "(node: AUDIT.md C20 — the remainder never absorbs a map entry, which gates "
            + "MemberDirectory.rho:15 and so the whole governance family)"
    );
}

/**
 * The **wire shape** of a `RhoExpr`, asserted against the node rather than against our own types.
 *
 * The parser accepts both this port's enveloped form and the bare form an early revision sent, so
 * nothing else in this suite would notice if the node stopped enveloping — and this suite is the
 * consumer-side citation the node's response-schema standard leans on. So the shape is pinned here,
 * on the raw body of the same endpoint the wallet uses. The expected values are measured, not
 * derived (`curl -X POST /api/explore-deploy`, devnet at block 644):
 *   new return in { return!(42) }              -> [{"ExprInt":{"data":42}}]
 *   new return in { return!({"a": "b"}) }      -> [{"ExprMap":{"data":{"a":{"ExprString":{"data":"b"}}}}}]
 *   new return in { return!(["x", 1]) }        -> [{"ExprList":{"data":[…]}]}]
 * i.e. the tag names the variant, the payload is a field-struct named `data`, and a dictionary is a
 * JSON **object** (not the pair list an intermediate revision of this port emitted).
 *
 * A failure here is a node-side finding (spec/API-SCHEMA.md on the node side), not a wallet bug.
 */
async function check_wire_schema(): Promise<void> {
    const cases: Array<[string, string, unknown]> = [
        ["scalar", "new return in { return!(42) }", { ExprInt: { data: 42 } }],
        [
            "dictionary",
            'new return in { return!({"a": "b"}) }',
            { ExprMap: { data: { a: { ExprString: { data: "b" } } } } },
        ],
        [
            "list",
            "new return in { return!([\"x\", 1]) }",
            { ExprList: { data: [{ ExprString: { data: "x" } }, { ExprInt: { data: 1 } }] } },
        ],
    ];

    for (const [label, term, want] of cases) {
        let got: unknown;
        try {
            const res = (await exploreDeployRaw(NODE, term)) as { expr?: unknown[] };
            got = res?.expr?.[0];
        } catch (err) {
            check(false, `wire: ${label} response readable (${(err as Error).message.slice(0, 120)})`);
            continue;
        }
        check(
            JSON.stringify(got) === JSON.stringify(want),
            `wire: ${label} is enveloped — the variant's payload carries its value in a \`data\` field`
                + ` (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`
        );
    }
}

/**
 * Why a case's output must not be recorded as a golden, or null when it may be. See the call site:
 * a golden is a node answer, and neither "the harness gave up", "the term never compiled", nor "it
 * sent nothing to the result channel" is one. The last is the subtle one: an empty result recorded
 * as the golden makes the failure the expected behaviour, which is how an outage got committed.
 */
function unrecordable(text: string, allowed_empty: boolean): string | null {
    if (/^TIMEOUT after /m.test(text)) return "the case did not return (timeout)";
    if (/Parsing error|free variables|process context/.test(text)) return "the term did not compile";
    if (!allowed_empty && text.trim() === "[]") return "it returned nothing, and this case expects a value";
    return null;
}

async function main() {
    console.log(`node:    ${NODE}`);
    console.log(`goldens: ${path.relative(process.cwd(), GOLDEN_DIR)}${RECORD ? "  (recording)" : ""}\n`);

    const acct = await get_account_from_private_key(KEY);
    if (!acct) throw new Error("could not derive a wallet from the deploy key");
    console.log(`wallet:  ${acct.revAddr}\n`);

    // Which account is funded differs by chain: the local devnet funds its validator/deployer at
    // genesis, while the public testnet's funded accounts are the playground set. Point the balance
    // case at whichever this node actually funds, so its golden is a real balance rather than `[0]`
    // (which would assert nothing about the node's vault behavior).
    if (IS_LOCAL) {
        CASES.checkBalance.args = { myGovRevAddr: acct.revAddr };
    }

    // No snippet may escape the sweep.
    const unclassified = (Object.keys(snippets) as Array<keyof typeof snippets>)
        .filter(k => !(k in CASES));
    check(unclassified.length === 0, `every snippet is classified (unclassified: ${unclassified.join(", ") || "none"})`);

    // A term its own source says must not be deployed never is. This is the invariant the whole
    // incident turned on: `towers` is explore-only, and trusting a comment to keep it that way is
    // what almost let me accept that my harness had submitted it as a chain write.
    for (const [name, c] of Object.entries(CASES)) {
        if (!c.explore_only) continue;
        check(
            effective_op(name) === "explore" && !needs_deploy(name as keyof typeof snippets),
            `${name}: explore-only in its source and stays on explore (${c.explore_only})`
        );
    }

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

        const output = normalise(pane.text, !!c.volatile_numbers);

        // Which side of the pane rule produced this — the result JSON, or an error/status.
        if (pane.errored) {
            errored.push(name);
            // An error/status is not JSON, so it is a failure unless the case declares it. Asserted
            // rather than merely counted: `errored` used to be reported and then ignored outside
            // --strict, so a node that errored on a contract read as a pass with a footnote.
            check(
                !!c.error_ok,
                `${name} [${op_label}] shows JSON, not an error/status — got ${JSON.stringify(output.slice(0, 160))}`
                    + (c.error_ok ? ` (declared: ${c.error_ok})` : "")
            );
        } else json_ok++;

        // An empty result is only acceptable where that is the contract's actual behaviour, or where
        // a declared node-side block makes an answer impossible until someone else changes the chain.
        const is_empty = output.trim() === "[]";
        const blocked = is_empty && !!c.blocked_by;
        if (is_empty) {
            check(
                !!c.returns_nothing || blocked,
                `${name} [${op_label}] returns a value`
                    + (c.returns_nothing
                        ? ` — allowed to return nothing: ${c.returns_nothing}`
                        : blocked
                            ? ` — blocked on the node: ${c.blocked_by}`
                            : " (got [])")
            );
        }

        // The tripwire that keeps `blocked_by` from becoming a resting place: a blocked case that
        // answers has had its defect fixed (or its contract swapped), and the declaration must go.
        if (c.blocked_by && !is_empty) {
            check(
                false,
                `${name} [${op_label}] is blocked no longer (${c.blocked_by}) — it answered, so remove `
                    + `the declaration and record its golden`
            );
        }

        // A declared exemption has to be doing something. If masking changed nothing, this case is
        // not run-dependent the way its reason claims, and the flag has become a resting place —
        // so it is asserted rather than trusted, in the same spirit as `returns_nothing` above. The
        // reason rides in the label, so every run prints why the exemption exists.
        if (c.volatile_numbers) {
            check(
                output !== normalise(pane.text),
                `${name} [${op_label}] pins a run-dependent number, and the golden masks it `
                    + `(${c.volatile_numbers})`
            );
        }

        // A blocked case records no golden, in either mode: `[]` here is the symptom of the node-side
        // defect, and committing it would encode the bug as the contract's behaviour.
        if (blocked) {
            check(true, `${name} [${op_label}] still blocked on the node (${c.blocked_by})`);
            continue;
        }

        if (RECORD) {
            // A golden must be the *node's* answer. A timeout is this harness giving up (the term may
            // still be running on the node), a parse error means the term never ran at all, and an
            // empty result where the case expects a value means the contract did not answer —
            // none is evidence about the contract, and recording one makes a broken environment
            // look correct on the next compare run. That is exactly how an outage got committed as
            // expected behaviour and produced minutes of results that meant nothing.
            const refused = unrecordable(output, !!c.returns_nothing);
            if (refused) {
                check(false, `${name} [${op_label}] NOT recorded: ${refused}`);
                continue;
            }

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

    console.log("\n--- node response schema ---");
    await check_wire_schema();
    await check_process_api_schema();

    console.log("\n--- governance handshake ---");
    await check_governance_handshake(acct.revAddr);

    console.log(`\n${ran} run (${json_ok} showing JSON, ${errored.length} showing an error/status), ${excluded.length} excluded`);
    if (errored.length > 0) {
        console.log(`showing an error/status: ${errored.join(", ")}`);
    }
    if (excluded.length > 0) {
        for (const e of excluded) console.log(`excluded: ${e}`);
    }

    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
