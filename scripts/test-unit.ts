// Pure unit tests for the wallet's logic — no devnet required.
// Run with: npm run test:unit

import { secp256k1 } from "@noble/curves/secp256k1.js";
import blake from "blakejs";
import { deployDataProtobufSerialize, signDeploy, decodeBase16 } from "../src/api/sign";
import { deploy, propose, getShards, runTxn, getTxn, getTxnList, dataAtName, getPosStatus, getDelegations } from "../src/api/client";
import * as bc from "../src/utils/blockchain";
import * as rho from "../src/utils/rho";
import { snippets, snippet_apply, snippet_meta } from "../src/modules/wallet/deploy/snippets";
import { tx_list, add_tx, refresh_tx_states } from "../src/utils/transactions";
import * as exposure from "../src/utils/exposure";
import { sweep } from "../src/utils/rnode";
import { PLAYGROUND_ACCOUNTS } from "../src/config/playground";
import { GENESIS_ADDRESSES } from "../src/config/genesis-addresses";
import type { DeployData, DeployRequest } from "../src/api/types";

const hex_of = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");

const DEPLOYER_PRIV = "a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76";
const DEPLOYER_ADDR = "11112VYAt8rUGNRRZX3eJdgagaAhtWTK8Js7F7X5iqddMVqyDTtYau";

let failures = 0;
function check(cond: boolean, label: string) {
    if (cond) console.log(`  PASS  ${label}`);
    else {
        console.error(`  FAIL  ${label}`);
        failures++;
    }
}

async function main() {
    // 1. deploy signing
    const dd: DeployData = {
        term: "Nil",
        timestamp: 1,
        phloPrice: 1,
        phloLimit: 1000000,
        validAfterBlockNumber: 0,
        shardId: "/root",
    };
    const signed = signDeploy(dd, DEPLOYER_PRIV);

    check(signed.sigAlgorithm === "secp256k1", "sigAlgorithm is secp256k1");
    check(signed.data.shardId === "/root", "DeployRequest body carries shardId");
    check(/^04[0-9a-f]{128}$/.test(signed.deployer), "deployer is a 65-byte uncompressed pubkey");
    check(/^30[0-9a-f]+$/.test(signed.signature), "signature is a DER hex string");

    // Verify the signature against the derived public key (recompute the hash), and — the stronger
    // assertion — recover the signer's public key from the signature and require it to be the
    // deployed `deployer`. Recovery pins the digest that was signed, so a signature over the wrong
    // message cannot pass by verifying against a key derived from the same wrong-message logic.
    const hashed = blake.blake2b(deployDataProtobufSerialize(signed.data), undefined, 32);
    check(
        secp256k1.verify(decodeBase16(signed.signature), hashed, decodeBase16(signed.deployer), { prehash: false, format: "der" }),
        "signature verifies (secp256k1 over blake2b256(protobuf))"
    );
    // Recover the signer's key from the signature + digest, over all four recovery bits, and require
    // that it is the key the deploy names. This pins the digest that was actually signed, which is
    // what `prehash` gets wrong when it is left at noble's default.
    const parsed = secp256k1.Signature.fromBytes(decodeBase16(signed.signature), "der");
    const recovered_keys = [0, 1, 2, 3].flatMap(bit => {
        try { return [hex_of(parsed.addRecoveryBit(bit).recoverPublicKey(hashed).toBytes(false))]; }
        catch { return []; }
    });
    check(
        recovered_keys.includes(signed.deployer),
        `a recovery bit reproduces the deploying key (${recovered_keys.length} candidate(s))`
    );
    // The authoritative check is not in this file: the node refuses a deploy whose signature does
    // not verify. `npm run test:api` signs real deploys, and every case of the acceptance suite
    // (`scripts/acceptance.sh`) signs one, so a signature over the wrong digest fails there loudly.

    // The critical shardId fix: field 11 must be written (tag byte 0x5a).
    const serialized = Array.from(deployDataProtobufSerialize(dd));
    check(serialized.includes(0x5a), "protobuf serialization writes field 11 (shardId)");

    // 1b. RCHIP #39 binary attachments — field 12, part of the signed payload.
    const without = Array.from(deployDataProtobufSerialize(dd));
    const withOne = Array.from(deployDataProtobufSerialize({ ...dd, attachments: ["deadbeef"] }));
    check(withOne.includes(0x62), "protobuf serialization writes field 12 (attachments)");
    check(withOne.length === without.length + 6, "one 4-byte attachment adds 6 bytes (tag+len+4)");
    check(!without.includes(0x62), "a deploy with no attachments writes no field 12");

    const signedAttached = signDeploy({ ...dd, attachments: ["deadbeef"] }, DEPLOYER_PRIV);
    check(
        Array.isArray(signedAttached.data.attachments) && signedAttached.data.attachments[0] === "deadbeef",
        "DeployRequest body carries attachments"
    );
    const attachedHash = blake.blake2b(
        deployDataProtobufSerialize({ ...dd, attachments: ["deadbeef"] }),
        undefined,
        32
    );
    check(
        secp256k1.verify(decodeBase16(signedAttached.signature), attachedHash, decodeBase16(signedAttached.deployer), { prehash: false, format: "der" }),
        "attachment deploy signature verifies"
    );
    const tamperedHash = blake.blake2b(
        deployDataProtobufSerialize({ ...dd, attachments: ["cafebabe"] }),
        undefined,
        32
    );
    check(
        !secp256k1.verify(decodeBase16(signedAttached.signature), tamperedHash, decodeBase16(signedAttached.deployer), { prehash: false, format: "der" }),
        "a tampered/stripped attachment fails signature verification"
    );

    // Strict hex, mirroring the node's base16::decode.
    check(decodeBase16("00ff")[1] === 0xff, "decodeBase16 decodes hex");
    check(decodeBase16("").length === 0, "decodeBase16 accepts empty (an empty attachment)");
    let badHex = false;
    try { decodeBase16("xyz"); } catch { badHex = true; }
    check(badHex, "decodeBase16 rejects non-hex");
    let oddHex = false;
    try { decodeBase16("abc"); } catch { oddHex = true; }
    check(oddHex, "decodeBase16 rejects odd-length hex");

    // 2. address derivation
    const acct = await bc.get_account_from_private_key(DEPLOYER_PRIV);
    check(acct?.revAddr === DEPLOYER_ADDR, `private key -> REV address (${acct?.revAddr})`);
    check(await bc.is_valid_rev_address(DEPLOYER_ADDR), "is_valid_rev_address accepts a valid address");
    check(!(await bc.is_valid_rev_address("not-a-rev-address")), "is_valid_rev_address rejects garbage");
    check((await bc.get_account(DEPLOYER_PRIV))?.revAddr === DEPLOYER_ADDR, "get_account resolves a private key");
    check((await bc.get_account(DEPLOYER_ADDR))?.revAddr === DEPLOYER_ADDR, "get_account resolves a REV address");

    // 2b. keystore round-trip and backwards compatibility.
    // The fixture was produced by the library this app used *before* the crypto migration, so it
    // fails if the successor ever stops reading files users already exported. The password is
    // "correct horse"; the key inside is the devnet deployer, so the address is a known constant.
    const legacy_keystore = {
        version: 3,
        id: "6aa6e875-0309-4491-9e77-b7a0e6c20504",
        address: "041e1eec23d118f0c4ffc814d4f415ac3ef3dcff",
        crypto: {
            ciphertext: "0fc8ac90b56adb2e7eadcbb9ec3ac4654f791068e942476744d2603d944b0985",
            cipherparams: { iv: "fb35242764de834f83a61c68795cb3b2" },
            cipher: "aes-128-ctr",
            kdf: "scrypt",
            kdfparams: {
                dklen: 32,
                salt: "78370c120990c9d526b07565f109c643f728dbe75e206615852f06037e414458",
                n: 131072, r: 8, p: 1,
            },
            mac: "edaf266b91c595c280ae6fd1367d69a7ea656f5c1a5eef1aaf6cda54d040a20c",
        },
    };
    const unlocked = await bc.get_account_from_keystore(legacy_keystore, "correct horse");
    check(unlocked?.revAddr === DEPLOYER_ADDR, `a keystore from the previous crypto library still unlocks (${unlocked?.revAddr})`);
    check((await bc.get_account_from_keystore(legacy_keystore, "wrong password")) === null, "a wrong keystore password unlocks nothing");

    const written = await bc.keystore_json(DEPLOYER_PRIV, "round trip");
    check(!!written && written.version === 3, "keystore_json writes a v3 keystore");
    const reread = written ? await bc.get_account_from_keystore(written, "round trip") : null;
    check(reread?.revAddr === DEPLOYER_ADDR, "a keystore written by this app unlocks to the same account");

    // 3. rholang templates
    const cb = rho.fn_check_balance(DEPLOYER_ADDR);
    check(cb.includes("getBalance") && cb.includes(DEPLOYER_ADDR), "fn_check_balance uses native getBalance + embeds addr");
    check(!cb.includes("findOrCreate") && !cb.includes('vault!("balance"'), "fn_check_balance has no Scala findOrCreate/balance");

    const tf = rho.fn_transfer_funds(DEPLOYER_ADDR, 100);
    check(tf.includes("transfer") && tf.includes("deployerId"), "fn_transfer_funds uses native transfer + deployerId");
    check(!tf.includes("findOrCreate") && !tf.includes("deployerAuthKey"), "fn_transfer_funds has no Scala findOrCreate/deployerAuthKey");

    // PoS templates. The node's bond signature is `bond(*deployerId, amount, ret)` — the old wallet
    // template omitted deployerId, so a bond deploy could never match (rholang/src/system_processes.rs).
    const bond = rho.fn_bond(100000000);
    check(bond.includes('"bond"') && bond.includes("deployerId") && bond.includes("100000000"),
        "fn_bond binds deployerId and passes amount to the native bond");
    check(/bond"\s*,\s*\*deployerId/.test(bond), "fn_bond passes *deployerId as bond's first argument");

    const unbond = rho.fn_unbond();
    check(unbond.includes('"withdraw"') && unbond.includes("*deployerId"), "fn_unbond calls native withdraw with deployerId");

    const trust = rho.fn_trust("04" + "ab".repeat(64), "trust");
    check(trust.includes('"trust"') && trust.includes('.hexToBytes()'), "fn_trust calls native trust with a byte-array key");
    const untrust = rho.fn_trust("04" + "ab".repeat(64), "untrust");
    check(untrust.includes('"untrust"'), "fn_trust can also emit untrust");

    // Delegated stake (law 57, #193). The landed call shape is
    // `delegate(*deployerId, operatorKeyBytes, amount, ret)` / `undelegate(*deployerId, operatorKeyBytes, ret)`
    // (rholang/src/system_processes.rs, examples/pos-delegate.rho): the delegator is the signer and
    // the operator is a *named* byte key.
    const OP_KEY = "04" + "ab".repeat(64);
    const delegate = rho.fn_delegate(OP_KEY, 40);
    check(/delegate"\s*,\s*\*deployerId/.test(delegate), "fn_delegate passes *deployerId first");
    check(delegate.includes('.hexToBytes()') && delegate.includes("40"), "fn_delegate sends the operator key as bytes and the amount");

    const undelegate = rho.fn_undelegate(OP_KEY);
    check(/undelegate"\s*,\s*\*deployerId/.test(undelegate), "fn_undelegate passes *deployerId first");
    check(undelegate.includes('.hexToBytes()'), "fn_undelegate sends the operator key as bytes");

    // A *deploy*'s result is read from its `rho:rchain:deployId` channel, not the first private
    // name (`spec/API-SCHEMA.md`, rule 3). A writer that replied on its first private name would show
    // nothing in the deploy status, silently hiding the node's refusal — so pin the channel.
    for (const [label, code] of [["fn_bond", bond], ["fn_unbond", unbond], ["fn_trust", trust], ["fn_delegate", delegate], ["fn_undelegate", undelegate]] as const) {
        check(code.includes("rho:rchain:deployId") && /deployId!\(result\)/.test(code),
            `${label} replies on the deployId channel so the deploy result is captured`);
    }

    const posInfo = rho.fn_pos_info(DEPLOYER_ADDR);
    check(posInfo.includes("getBonds") && posInfo.includes("getTrusted"), "fn_pos_info reads both getBonds and getTrusted");
    check(posInfo.includes("getOrElse"), "fn_pos_info looks the key up in rholang (no JSON map-key dependency)");
    check(!posInfo.includes("deployId"), "fn_pos_info is explore-only (no deployId channel)");

    // 4. snippets + metadata
    const transferCode = snippet_apply("transfer", ["toAddr", "100000000"]);
    check(transferCode.includes('"toAddr"') && transferCode.includes("100000000"), "snippet_apply formats string + number args");
    check(transferCode.includes("revVault") && transferCode.includes("transfer"), "transfer snippet emits native revVault transfer");

    const checkBalanceCode = snippet_apply("checkBalance", [DEPLOYER_ADDR]);
    check(checkBalanceCode.includes("getBalance"), "checkBalance snippet emits native getBalance");

    const doitCode = snippet_apply("doit", ["inbox", "Group", "", "admin", "register", "a,b"]);
    check(doitCode.includes("Set(a,b)"), "doit snippet formats a set arg as Set(...)");

    for (const name of Object.keys(snippets) as Array<keyof typeof snippets>) {
        check(!!snippet_meta[name] && snippet_meta[name].description.length > 0, `snippet_meta has a description for ${name}`);
    }

    // 5. client response parsing (stubbed fetch)
    const originalFetch = globalThis.fetch;
    const dummy: DeployRequest = { data: dd, deployer: "00", signature: "00", sigAlgorithm: "secp256k1" };
    try {
        globalThis.fetch = (async () => new Response(JSON.stringify("Success!\nDeployId is: deadbeef"), { status: 200 })) as typeof fetch;
        check((await deploy("http://x", dummy)) === "deadbeef", "deploy parses the deploy id from the success string");

        globalThis.fetch = (async () => new Response('"Deploy signature is invalid."', { status: 400 })) as typeof fetch;
        let threw = false;
        try { await deploy("http://x", dummy); } catch { threw = true; }
        check(threw, "deploy throws on a non-2xx response");

        globalThis.fetch = (async () => new Response(JSON.stringify("Success! Block abc created and added."), { status: 200 })) as typeof fetch;
        check((await propose("http://x")).includes("Block abc created"), "propose returns the plain string");

        globalThis.fetch = (async () => new Response(JSON.stringify({
            latestBlockNumber: 250, epochLength: 100, quarantineLength: 1000,
            epoch: 2, blocksUntilEpochBoundary: 50,
            activeValidators: ["04aa"],
            pendingWithdrawals: [{ validator: "04aa", stagedAtBlock: 200, blocksRemaining: 400 }],
        }), { status: 200 })) as typeof fetch;
        const pos = await getPosStatus("http://x");
        check(
            pos?.epoch === 2 && pos.blocksUntilEpochBoundary === 50 && pos.pendingWithdrawals[0].blocksRemaining === 400,
            "getPosStatus parses the /api/v1/pos response"
        );

        // `GET /api/v1/pos` was added for AUDIT C148; an older node 404s and the wallet must degrade
        // rather than throw.
        globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
        check((await getPosStatus("http://x")) === null, "getPosStatus returns null when the node has no pos route");

        // Delegator-scoped read (law 57, #193). The inner countdown field is `deadline`, not
        // `stagedAtBlock` — the node renamed it for AUDIT C206 because the stored value already
        // includes the quarantine, and calling it the request height made the countdown wrong.
        globalThis.fetch = (async () => new Response(JSON.stringify([
            { operator: "04aa", amount: 100, accruedRewards: 5, pendingUndelegation: { deadline: 1000, blocksRemaining: 400 } },
            { operator: "04bb", amount: 200, accruedRewards: 0, pendingUndelegation: null },
        ]), { status: 200 })) as typeof fetch;
        const dels = await getDelegations("http://x", "04cc");
        check(
            dels?.length === 2 && dels[0].accruedRewards === 5
                && dels[0].pendingUndelegation?.deadline === 1000
                && dels[0].pendingUndelegation?.blocksRemaining === 400
                && dels[1].pendingUndelegation === null,
            "getDelegations parses the delegator-scoped response"
        );

        globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
        check((await getDelegations("http://x", "04cc")) === null, "getDelegations returns null when the node has no delegations route");

        // The node answers 400 for a malformed key rather than an empty list — an empty list is a
        // true answer about a delegator with no positions, and must not be confused with a typo.
        globalThis.fetch = (async () => new Response(JSON.stringify({ error: "delegator must be a hex-encoded 65-byte public key" }), { status: 400 })) as typeof fetch;
        let delegations_threw = false;
        try { await getDelegations("http://x", "zz"); } catch { delegations_threw = true; }
        check(delegations_threw, "getDelegations throws on a malformed key rather than reporting no positions");
    } finally {
        globalThis.fetch = originalFetch;
    }

    // 5a. data-at-name sends the *enveloped* request. The node's request DTOs are field-structs, so
    // the bare `{"UnforgDeploy":"<hex>"}` the wallet used to send is rejected outright ("invalid
    // type: string, expected struct Data"); nothing caught that until a script type-check and the
    // integration test both ran. The body is asserted here rather than at the node.
    try {
        let sent: string | undefined;
        globalThis.fetch = (async (_url, opt) => {
            sent = String((opt as RequestInit | undefined)?.body);
            return new Response(JSON.stringify({ expr: [], block: {} }), { status: 200 });
        }) as typeof fetch;
        await dataAtName("http://x", { UnforgDeploy: "deadbeef" }, 1);
        check(
            sent === JSON.stringify({ name: { UnforgDeploy: { data: "deadbeef" } }, depth: 1 }),
            `dataAtName envelopes the name on the wire (${sent})`
        );
        // An already-enveloped payload is not double-wrapped.
        await dataAtName("http://x", { UnforgPrivate: { data: "aa" } }, 1);
        check(
            sent === JSON.stringify({ name: { UnforgPrivate: { data: "aa" } }, depth: 1 }),
            "dataAtName passes an enveloped payload through once"
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    // 5b. shards + cross-shard transaction DTOs (stubbed fetch)
    const txnRecord = {
        txnId: "aabb",
        state: "committed",
        coordinator: "00",
        recordHash: "11",
        legs: [{ shardId: "/root", amount: 30, to: "dest" }],
        votes: [{ shardId: "/root", vote: "ready" }],
        reason: null,
    };
    try {
        globalThis.fetch = (async (url, opt) => {
            const u = String(url);
            if (u.includes("/api/v1/shards")) {
                return new Response(JSON.stringify({
                    primaryShard: "/root",
                    shardCount: 1,
                    shards: [{ shardId: "/root", primary: true, latestBlockNumber: 7 }],
                }), { status: 200 });
            }
            if (u.includes("/api/v1/txn/")) {
                return new Response(JSON.stringify(txnRecord), { status: 200 });
            }
            if (u.includes("/api/v1/txn")) {
                const method = (opt as RequestInit | undefined)?.method;
                const body = method === "GET" ? { inFlight: [txnRecord] } : txnRecord;
                return new Response(JSON.stringify(body), { status: 200 });
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const shards = await getShards("http://x");
        check(shards.primaryShard === "/root" && shards.shards[0].primary, "getShards parses the shards response");

        const txn = await runTxn("http://x", { txnId: "aabb", legs: [{ shardId: "/root", amount: 30, to: "dest" }] });
        check(txn.state === "committed" && txn.legs[0].amount === 30, "runTxn parses a TxnRecord");

        const list = await getTxnList("http://x");
        check(list.inFlight.length === 1, "getTxnList parses inFlight");

        const one = await getTxn("http://x", "aabb");
        check(one?.state === "committed", "getTxn parses a record");
    } finally {
        globalThis.fetch = originalFetch;
    }

    // 6. transactions add_tx
    tx_list.length = 0;
    add_tx({ deployId: "abc123", kind: "deploy", description: "test", timestamp: Date.now(), status: "pending" });
    check(tx_list.length === 1 && tx_list[0].deployId === "abc123", "add_tx prepends to tx_list");

    // 7. transactions reconciliation (stubbed fetch)
    tx_list.length = 0;
    globalThis.fetch = (async (url) => {
        const u = String(url);
        if (u.includes("/api/v1/deploys")) {
            return new Response(JSON.stringify({
                deploys: [{ deployId: "deadbeef", timestamp: 1, deployer: "de", term: "Nil", phloPrice: 1, phloLimit: 1, validAfterBlockNumber: 0 }],
            }), { status: 200 });
        }
        if (u.includes("/api/v1/deploy-status/")) {
            return new Response(JSON.stringify({ NotProcessed: { status: "Pooled" } }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
    }) as typeof fetch;
    await refresh_tx_states("http://x");
    check(tx_list.some(t => t.deployId === "deadbeef" && t.status === "pending"), "refresh_tx_states reconciles a pooled deploy as pending");
    globalThis.fetch = originalFetch;

    // 12. quantum key hygiene (src/utils/exposure.ts, `rnode.sweep`)
    {
        // The sweep term reads the balance inside the deploy and sends all of it, replying on deployId.
        const term = rho.fn_sweep("1111from", "1111to");
        check(term.includes('revVault!("getBalance", "1111from", *balanceCh)'), "fn_sweep reads the from-vault balance in the deploy");
        check(term.includes('revVault!("transfer", *deployerId, "1111to", balance, *resultCh)'), "fn_sweep transfers exactly that balance to the target");
        check(term.includes("deployId!((true, balance))") && term.includes("rho:rchain:deployId"), "fn_sweep replies on the deployId channel");

        // Warn only on a revealed key above the threshold.
        const revealed: exposure.Exposure = { state: "revealed", record: { source: "chain", recordedAt: 0, blockNumber: 3 } };
        const unseen: exposure.Exposure = { state: "not-seen" };
        const rev = exposure.DROPS_PER_REV;
        check(exposure.should_warn(revealed, 11 * rev, 10), "should_warn: revealed and above threshold");
        check(!exposure.should_warn(revealed, 10 * rev, 10), "should_warn: revealed at the threshold is not above it");
        check(!exposure.should_warn(unseen, 1000 * rev, 10), "should_warn: an unrevealed key never warns");
        check(!exposure.should_warn(revealed, null, 10), "should_warn: unknown balance does not warn");
        check(exposure.get_threshold_rev() === exposure.DEFAULT_THRESHOLD_REV, "threshold defaults without localStorage");

        // Out-of-order answers: only the latest check counts, and cancel drops a pending one.
        {
            const gates: Array<(v: string) => void> = [];
            const slow = exposure.latest_only((_: string) => new Promise<string>(res => gates.push(res)));
            const first = slow.run("old account");
            const second = slow.run("new account");
            gates[1]("new");
            gates[0]("old");
            check(await second === "new", "latest_only: the latest check's result is used");
            check(await first === null, "latest_only: an earlier check that resolves later is dropped");
            const pending = slow.run("switched away");
            slow.cancel();
            gates[2]("late");
            check(await pending === null, "latest_only: cancel drops a pending check");
        }

        // The deployer index: one lookup, read three ways.
        const target = await bc.create_account();
        const other = await bc.create_account();
        if (!target || !other) throw new Error("create_account failed");
        let asked = "";
        const index_fetch = (reply: unknown, status = 200) => (async (url: RequestInfo | URL) => {
            const s = String(url);
            if (s.endsWith("/api/v1/deploys")) return new Response(JSON.stringify({ deploys: [] }), { status: 200 });
            const m = s.match(/\/api\/v1\/deployer\/([0-9a-f]+)$/);
            if (m) {
                asked = m[1];
                return new Response(JSON.stringify(reply), { status });
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;

        try {
            globalThis.fetch = index_fetch({ block: { blockNumber: 75, blockHash: "h75" }, indexedFromHeight: 0 });
            const found = await exposure.check_exposure("http://x", "0x" + target.pubKey.toUpperCase());
            check(found.state === "revealed" && found.record.source === "chain" && found.record.blockNumber === 75,
                `a block from the index reveals the key (${JSON.stringify(found)})`);
            check(asked === exposure.deployer_key_hash(target.pubKey) && asked.length === 64,
                "the index is asked by the key's blake2b256 hash, never the key");
            check(!asked.includes(target.pubKey.slice(2, 20)), "the key itself is not in the request");
            // The same vector rchain-rust pins for `deployer_index_key` (node/src/api/web_api_impl.rs).
            check(exposure.deployer_key_hash("04".repeat(65))
                === "b0ec3ad69aacbdc6499f533d58abd768331f5977fb42d302c3cf7f8a401e75f1",
                "deployer_key_hash matches the node's index key");

            // Remembered: the node is not asked again.
            asked = "";
            const again = await exposure.check_exposure("http://x", target.pubKey);
            check(again.state === "revealed" && asked === "", "a revealed key is remembered without asking again");

            globalThis.fetch = index_fetch({ block: null, indexedFromHeight: 0 });
            const unseen = await exposure.check_exposure("http://x", other.pubKey);
            check(unseen.state === "not-seen", "a complete index without the key is not-seen");

            globalThis.fetch = index_fetch({ block: null, indexedFromHeight: 4000 });
            const partial = await exposure.check_exposure("http://x", other.pubKey);
            check(partial.state === "indexing" && partial.indexedFrom === 4000,
                `a backfilling index is "indexing", never not-seen (${JSON.stringify(partial)})`);

            globalThis.fetch = index_fetch("not found", 404);
            const no_index = await exposure.check_exposure("http://x", other.pubKey);
            check(no_index.state === "unknown", "a node without the index is unknown, not not-seen");

            // A pooled deploy counts as revealed.
            globalThis.fetch = (async (url: RequestInfo | URL) => String(url).endsWith("/api/v1/deploys")
                ? new Response(JSON.stringify({ deploys: [{ deployId: "p1", deployer: other.pubKey }] }), { status: 200 })
                : new Response("not found", { status: 404 })) as typeof fetch;
            const pooled = await exposure.check_exposure("http://x", other.pubKey);
            check(pooled.state === "revealed" && pooled.record.source === "pool", "a pooled deploy reveals the key");

            // A pool that cannot be read leaves a negative answer marked, not passed off as complete.
            const quiet = await bc.create_account();
            if (!quiet) throw new Error("create_account failed");
            globalThis.fetch = (async (url: RequestInfo | URL) => String(url).endsWith("/api/v1/deploys")
                ? new Response("boom", { status: 500 })
                : new Response(JSON.stringify({ block: null, indexedFromHeight: 0 }), { status: 200 })) as typeof fetch;
            const no_pool = await exposure.check_exposure("http://x", quiet.pubKey);
            check(no_pool.state === "not-seen" && no_pool.poolUnread === true,
                `an unreadable pool marks not-seen as pool-unread (${JSON.stringify(no_pool)})`);
            check(exposure.describe_exposure(no_pool).includes("pool could not be read"), "the pool-unread note is shown");
            globalThis.fetch = index_fetch({ block: null, indexedFromHeight: 0 });
            const pool_read = await exposure.check_exposure("http://x", quiet.pubKey);
            check(pool_read.state === "not-seen" && !("poolUnread" in pool_read), "a read pool leaves not-seen unmarked");

            // The node being unreachable is "unknown", never "not seen".
            globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
            const fresh_key = await bc.create_account();
            const unknown = await exposure.check_exposure("http://x", fresh_key!.pubKey);
            check(unknown.state === "unknown", "an unreachable node reports unknown, not not-seen");

            // The sweep: signing marks the key revealed, and the term moves everything to the target
            // from the address derived from the signing key.
            const signer = await bc.get_account_from_private_key(DEPLOYER_PRIV);
            const dest = await bc.create_account();
            let sent_term = "";
            globalThis.fetch = (async (url: RequestInfo | URL, opt?: RequestInit) => {
                const s = String(url);
                if (s.endsWith("/api/status")) return new Response(JSON.stringify({ latestBlockNumber: 1, minPhloPrice: 1, shardId: "/root" }), { status: 200 });
                if (s.endsWith("/api/deploy")) {
                    sent_term = (JSON.parse(String(opt?.body)) as DeployRequest).data.term;
                    return new Response(JSON.stringify("Success!\nDeployId is: abcd"), { status: 200 });
                }
                if (s.includes("/api/v1/deploy-status/")) {
                    return new Response(JSON.stringify({ ProcessedWithSuccess: { deployResult: [], block: {} } }), { status: 200 });
                }
                return new Response("not found", { status: 404 });
            }) as typeof fetch;
            check(exposure.known_reveal(signer!.pubKey) === null, "the deployer key is not yet recorded as revealed");
            const swept = await sweep("http://x", { name: "t", ...signer!, revAddr: "stale" }, dest!.revAddr);
            check(swept.error === null && swept.deployId === "abcd", `sweep submits and tracks the deploy (${swept.error})`);
            check(sent_term.includes(`"getBalance", "${DEPLOYER_ADDR}"`) && sent_term.includes(`"${dest!.revAddr}", balance`),
                "sweep reads the key-derived address (not the stored one) and targets the fresh address");
            check(exposure.known_reveal(signer!.pubKey)?.source === "signed-here", "signing a deploy records the key as revealed");
            check(tx_list[0]?.kind === "sweep", "sweep is tracked as a sweep transaction");

            const bad = await sweep("http://x", { name: "t", ...signer! }, "not-an-address");
            check(bad.deployId === null && /valid address/.test(bad.error ?? ""), "sweep refuses an invalid target before signing");
            const self = await sweep("http://x", { name: "t", ...signer! }, DEPLOYER_ADDR);
            check(self.deployId === null && /own address/.test(self.error ?? ""), "sweep refuses to sweep to its own address");
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    // 11. playground accounts: every published key derives its published address
    // (the keys are public by design — this only guards the table against drifting)
    for (const account of PLAYGROUND_ACCOUNTS) {
        const derived = await bc.get_account_from_private_key(account.privKey);
        check(
            derived?.revAddr === account.revAddr,
            `playground ${account.name}: key derives ${account.revAddr}`
        );
    }
    check(
        new Set(PLAYGROUND_ACCOUNTS.map(a => a.name)).size === PLAYGROUND_ACCOUNTS.length,
        "playground account names are unique"
    );
    check(
        GENESIS_ADDRESSES.length === PLAYGROUND_ACCOUNTS.length &&
        GENESIS_ADDRESSES.every((a, i) => a === PLAYGROUND_ACCOUNTS[i].revAddr),
        "genesis-addresses.ts matches the account addresses (app bundle carries no keys)"
    );

    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
