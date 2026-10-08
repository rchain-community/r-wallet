// Live check of quantum key hygiene against a running node (`-- --node <url>`, default
// http://localhost:40403): fund a fresh account, confirm its key is not seen, sweep it to another
// fresh account, then confirm the node's deployer index finds the sweeper's key and the balance moved.
// Needs a node with the deployer index (rchain-rust `GET /api/v1/deployer`) whose genesis funds
// the devnet deployer key (as `tools/devnet.sh` does).
//
//   npx tsx scripts/probe-sweep.mts -- --node http://localhost:40403

import * as bc from "../src/utils/blockchain";
import * as rho from "../src/utils/rho";
import * as exposure from "../src/utils/exposure";
import { deploy, sweep, SWEEP_PHLO_LIMIT } from "../src/utils/rnode";
import { unwrap_payload } from "../src/api/rho-json";

const DEPLOYER_PRIV = "a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76";
const arg = process.argv.indexOf("--node");
const NODE = arg > 0 ? process.argv[arg + 1] : "http://localhost:40403";
const AMOUNT = 5 * exposure.DROPS_PER_REV;

const funder = await bc.get_account_from_private_key(DEPLOYER_PRIV);
const a = await bc.create_account();
const b = await bc.create_account();
if (!funder || !a || !b) throw new Error("key derivation failed");

let failures = 0;
function check(cond: boolean, label: string) {
    console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
    if (!cond) failures++;
}
// Balances are read with a deploy signed by the funder (whose key is public anyway), not
// explore-deploy: a validator refuses explore ("can only be executed on read-only RNode").
const bal = async (addr: string) => {
    const term = `new revVault(\`rho:rchain:revVault\`), deployId(\`rho:rchain:deployId\`), ch in {
      revVault!("getBalance", "${addr}", *ch) | for (@b <- ch) { deployId!(b) } }`;
    const r = await deploy(NODE, { name: "funder", ...funder }, term, 100000);
    const e = r.expr?.[0];
    if (r.error || !e || !("ExprInt" in e)) { console.log(`  balance of ${addr}: ${r.error}`); return -1; }
    return unwrap_payload(e.ExprInt);
};


const fund = await deploy(NODE, { name: "funder", ...funder }, rho.fn_transfer_funds(a.revAddr, AMOUNT), 500000);
check(fund.error === null, `funded ${a.revAddr} (${fund.error})`);
check(await bal(a.revAddr) === AMOUNT, `fresh account holds ${AMOUNT}`);

const before = await exposure.check_exposure(NODE, a.pubKey);
check(before.state === "not-seen", `fresh key not seen on chain (${exposure.describe_exposure(before)})`);

const swept = await sweep(NODE, { name: "a", ...a }, b.revAddr);
console.log("  sweep result:", JSON.stringify(swept.expr), swept.error);
check(swept.error === null, "sweep deploy processed without error");
const moved = await bal(b.revAddr);
const dust = await bal(a.revAddr);
console.log(`  moved ${moved} drops; ${dust} drops left at the old address`);
check(moved > 0 && moved < AMOUNT, "fresh address received the balance net of the phlo pre-charge");
check(dust >= 0 && dust <= SWEEP_PHLO_LIMIT, "only the phlo refund (≤ phloLimit × price) stays behind");
check(moved + dust <= AMOUNT, "nothing created");

// Forget what this process signed, so the answer has to come from the chain.
for (const k of Object.keys(exposure.revealed_keys)) delete exposure.revealed_keys[k];
const after = await exposure.check_exposure(NODE, a.pubKey);
check(after.state === "revealed" && after.record.source === "chain", `sweeper key found on chain (${exposure.describe_exposure(after)})`);
const target = await exposure.check_exposure(NODE, b.pubKey);
check(target.state === "not-seen", `sweep target key still unseen (${exposure.describe_exposure(target)})`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
