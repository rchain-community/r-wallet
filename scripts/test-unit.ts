// Pure unit tests for the wallet's logic — no devnet required.
// Run with: npm run test:unit

import { secp256k1 } from "@noble/curves/secp256k1.js";
import blake from "blakejs";
import { deployDataProtobufSerialize, signDeploy, decodeBase16 } from "../src/api/sign";
import { deploy, propose, getShards, runTxn, getTxn, getTxnList, dataAtName } from "../src/api/client";
import * as bc from "../src/utils/blockchain";
import * as rho from "../src/utils/rho";
import { snippets, snippet_apply, snippet_meta } from "../src/modules/wallet/deploy/snippets";
import { tx_list, add_tx, refresh_tx_states } from "../src/utils/transactions";
import { PLAYGROUND_ACCOUNTS, pick_random_account } from "../src/config/playground";
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

    // 12. testnet wallet: the card's random pick
    check(PLAYGROUND_ACCOUNTS.length > 0, `testnet accounts: ${PLAYGROUND_ACCOUNTS.length} available`);
    check(
        pick_random_account(undefined, () => 0)?.revAddr === PLAYGROUND_ACCOUNTS[0].revAddr,
        "pick with rand=0 selects the first account"
    );
    check(
        pick_random_account(undefined, () => 0.999)?.revAddr === PLAYGROUND_ACCOUNTS[PLAYGROUND_ACCOUNTS.length - 1].revAddr,
        "pick with rand~1 selects the last account"
    );
    check(
        pick_random_account(undefined, () => 1)?.revAddr === PLAYGROUND_ACCOUNTS[0].revAddr,
        "an out-of-range rand is clamped instead of yielding undefined"
    );

    const excluded_addr = PLAYGROUND_ACCOUNTS[0].revAddr;
    let avoided = true;
    for (let i = 0; i < 50; i++) {
        if (pick_random_account(excluded_addr)?.revAddr === excluded_addr) avoided = false;
    }
    check(avoided, "the excluded account is never re-picked while others remain");
    check(
        pick_random_account("1111notARealAddress", () => 0)?.revAddr === PLAYGROUND_ACCOUNTS[0].revAddr,
        "excluding an address outside the table is a no-op"
    );

    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
