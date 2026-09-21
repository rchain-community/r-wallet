// Pure unit tests for the wallet's logic — no devnet required.
// Run with: npm run test:unit

import elliptic from "elliptic";
import blake from "blakejs";
import { deployDataProtobufSerialize, signDeploy, decodeBase16 } from "../src/api/sign";
import { deploy, propose, getShards, runTxn, getTxn, getTxnList } from "../src/api/client";
import * as bc from "../src/utils/blockchain";
import * as rho from "../src/utils/rho";
import { snippets, snippet_apply, snippet_meta } from "../src/modules/wallet/deploy/snippets";
import { tx_list, add_tx, refresh_tx_states } from "../src/utils/transactions";
import { PLAYGROUND_ACCOUNTS, pick_random_account } from "../src/config/playground";
import type { DeployData, DeployRequest } from "../src/api/types";

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

    // Verify the signature against the derived public key (recompute the hash).
    const ec = new elliptic.ec("secp256k1");
    const key = ec.keyFromPublic(signed.deployer, "hex");
    const hashed = blake.blake2bHex(deployDataProtobufSerialize(signed.data), undefined, 32);
    check(key.verify(hashed, signed.signature), "signature verifies (secp256k1 over blake2b256(protobuf))");

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
    const attachedKey = ec.keyFromPublic(signedAttached.deployer, "hex");
    const attachedHash = blake.blake2bHex(
        deployDataProtobufSerialize({ ...dd, attachments: ["deadbeef"] }),
        undefined,
        32
    );
    check(attachedKey.verify(attachedHash, signedAttached.signature), "attachment deploy signature verifies");
    const tamperedHash = blake.blake2bHex(
        deployDataProtobufSerialize({ ...dd, attachments: ["cafebabe"] }),
        undefined,
        32
    );
    check(
        !attachedKey.verify(tamperedHash, signedAttached.signature),
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
