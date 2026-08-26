// Integration test: exercises the real `src/api` modules against a running
// devnet. Run with: npm run test:api  (requires the devnet on localhost:40403/40405).

import {
    getStatus,
    getCapabilities,
    getPooledDeploys,
    exploreDeploy,
    deploy,
    deployStatus,
    propose,
    dataAtName,
    getBlock,
} from "../src/api/client";
import { signDeploy } from "../src/api/sign";
import { rhoExprToJson } from "../src/api/rho-json";
import { faucet } from "../src/api/faucet";
import * as bc from "../src/utils/blockchain";
import * as rho from "../src/utils/rho";
import * as rnode from "../src/utils/rnode";
import { tx_list, refresh_tx_states } from "../src/utils/transactions";
import type { DeployData } from "../src/api/types";

const HTTP = "http://localhost:40403";
const ADMIN = "http://localhost:40405";
const DEPLOYER_PRIV = "a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76";

let failures = 0;
function check(cond: boolean, label: string) {
    if (cond) console.log(`  PASS  ${label}`);
    else {
        console.error(`  FAIL  ${label}`);
        failures++;
    }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
    // 1. status
    const status = await getStatus(HTTP);
    check(typeof status.shardId === "string", `status.shardId = "${status.shardId}"`);
    check(typeof status.minPhloPrice === "number", `status.minPhloPrice = ${status.minPhloPrice}`);
    check(typeof status.latestBlockNumber === "number", `status.latestBlockNumber = ${status.latestBlockNumber}`);

    // 2. explore-deploy: simple term + rhoExprToJson
    const simple = await exploreDeploy(HTTP, "new return in { return!(42) }");
    check(Array.isArray(simple.expr) && simple.expr.length === 1, "explore-deploy returns one expr");
    check("ExprInt" in simple.expr[0] && simple.expr[0].ExprInt === 42, "expr[0] is {ExprInt:42}");
    check(rhoExprToJson(simple.expr[0]) === 42, "rhoExprToJson(ExprInt) === 42");
    check(!!simple.block?.blockHash, "explore-deploy returns block.blockHash");

    // 3. explore-deploy via the real check_balance rholang
    const deployer = await bc.get_account_from_private_key(DEPLOYER_PRIV);
    check(!!deployer, "derive deployer address from private key");
    const bal = await exploreDeploy(HTTP, rho.fn_check_balance(deployer!.revAddr));
    check(
        !!bal.expr[0] && "ExprInt" in bal.expr[0] && bal.expr[0].ExprInt >= 0,
        `check_balance returns ExprInt (${bal.expr[0] && "ExprInt" in bal.expr[0] ? bal.expr[0].ExprInt : "?"})`
    );

    // 4. deploy (sign a term that writes to the deployId channel)
    const term = "new deployId(`rho:rchain:deployId`) in { deployId!(42) }";
    const deployData: DeployData = {
        term,
        timestamp: Date.now(),
        phloPrice: Math.max(1, status.minPhloPrice),
        phloLimit: 500000,
        validAfterBlockNumber: status.latestBlockNumber,
        shardId: "root",
    };
    const signed = signDeploy(deployData, DEPLOYER_PRIV);
    const deployId = await deploy(HTTP, signed);
    check(/^[0-9a-f]+$/.test(deployId), `deploy returns hex deployId (${deployId.slice(0, 16)}...)`);

    // 5. deploy-status -> poll to terminal state
    let processed = false;
    for (let i = 0; i < 20 && !processed; i++) {
        const st = await deployStatus(HTTP, deployId);
        if ("ProcessedWithSuccess" in st) {
            check(Array.isArray(st.ProcessedWithSuccess.deployResult), "deployStatus -> ProcessedWithSuccess");
            processed = true;
        } else if ("ProcessedWithError" in st) {
            check(false, `deployStatus -> ProcessedWithError: ${st.ProcessedWithError.deployError}`);
            processed = true;
        } else {
            await sleep(3000);
        }
    }
    check(processed, "deployStatus reached a terminal state");

    // 6. data-at-name
    const dan = await dataAtName(HTTP, { UnforgDeploy: deployId }, 1);
    check(Array.isArray(dan.exprs), "data-at-name returns exprs array");
    check(typeof dan.length === "number", "data-at-name returns length");

    // 7. getBlock (use the block hash returned by explore-deploy)
    const block = await getBlock(HTTP, simple.block.blockHash);
    check(!!block.blockInfo, "getBlock returns blockInfo");
    check(Array.isArray(block.deploys), "getBlock returns deploys array");

    // 8. propose (admin; on an autoproposing devnet this is redundant and may
    //    race with autopropose -> "another propose is in progress", which is harmless)
    try {
        const proposed = await propose(ADMIN);
        check(typeof proposed === "string" && proposed.length > 0, `propose returns string (${proposed.slice(0, 48)}...)`);
    } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("another propose is in progress")) {
            check(true, "propose: another propose in progress (autopropose race, harmless)");
        } else {
            check(false, `propose failed: ${msg.slice(0, 140)}`);
        }
    }

    // 9. faucet end-to-end (faucet is submit-and-track; poll deploy-status)
    const target = await bc.create_account();
    check(!!target, "faucet: create target account");
    const { deployId: faucetId } = await faucet(HTTP, target!.revAddr);
    check(/^[0-9a-f]+$/.test(faucetId), `faucet returns deployId (${faucetId.slice(0, 16)}...)`);

    let faucetDone = false;
    for (let i = 0; i < 20 && !faucetDone; i++) {
        const st = await deployStatus(HTTP, faucetId);
        if ("ProcessedWithSuccess" in st) {
            faucetDone = true;
        } else if ("ProcessedWithError" in st) {
            check(false, `faucet deploy failed: ${st.ProcessedWithError.deployError}`);
            faucetDone = true;
        } else {
            await sleep(3000);
        }
    }
    check(faucetDone, "faucet deploy reached a terminal state");

    const targetBal = await exploreDeploy(HTTP, rho.fn_check_balance(target!.revAddr));
    const fundedAmt = targetBal.expr[0] && "ExprInt" in targetBal.expr[0] ? targetBal.expr[0].ExprInt : 0;
    check(fundedAmt > 0, `faucet funded target (balance=${fundedAmt}${fundedAmt === 0 ? " — node-side revVault transfer persistence bug" : ""})`);

    // 10. capabilities + pooled deploys
    const caps = await getCapabilities(HTTP);
    check(typeof caps.autopropose === "boolean", `capabilities.autopropose = ${caps.autopropose}`);
    check(typeof caps.proposeOnDeploy === "boolean", `capabilities.proposeOnDeploy = ${caps.proposeOnDeploy}`);
    check(typeof caps.adminHttp === "boolean", `capabilities.adminHttp = ${caps.adminHttp}`);
    check(typeof caps.faucet === "boolean", `capabilities.faucet = ${caps.faucet}`);

    const pool = await getPooledDeploys(HTTP);
    check(Array.isArray(pool.deploys), "getPooledDeploys returns a deploys array");

    // 11. rnode seam: check_balance / transfer / deploy
    const deployerWallet = { name: "deployer", ...deployer! };
    const seamBal = await rnode.check_balance(HTTP, deployer!.revAddr);
    check(typeof seamBal.balance === "number" && seamBal.balance >= 0, `rnode.check_balance returns a balance (${seamBal.balance})`);

    tx_list.length = 0;
    const toWallet = { name: "target", ...(await bc.create_account())! };
    const transferRes = await rnode.transfer(HTTP, deployerWallet, toWallet, 100000000);
    check(/^[0-9a-f]+$/.test(transferRes.deployId ?? ""), `rnode.transfer returns a deployId (${transferRes.deployId?.slice(0, 16)}...)`);
    check(tx_list.some(t => t.deployId === transferRes.deployId), "rnode.transfer records a pending transaction");

    const deployRes = await rnode.deploy(HTTP, deployerWallet, "new deployId(`rho:rchain:deployId`) in { deployId!(42) }", 500000);
    check(/^[0-9a-f]+$/.test(deployRes.deployId ?? ""), `rnode.deploy returns a deployId (${deployRes.deployId?.slice(0, 16)}...)`);
    check(Array.isArray(deployRes.expr), `rnode.deploy returns the result expr (${JSON.stringify(deployRes.expr)})`);
    check(tx_list.some(t => t.deployId === deployRes.deployId), "rnode.deploy records a pending transaction");

    // 12. reconciliation: refresh_tx_states finalizes a processed deploy
    await refresh_tx_states(HTTP);
    const tx = tx_list.find(t => t.deployId === deployRes.deployId);
    check(tx?.status === "finalized", `refresh_tx_states finalizes a processed deploy (${tx?.status})`);

    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
