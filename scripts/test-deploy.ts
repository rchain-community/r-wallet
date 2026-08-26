// Integration test for deploys and the "Output" window JSON formatting.
// Deploys terms that return different result shapes and asserts the exact JSON
// that the editor would show via formatRhoResult. Requires a running devnet.
// Run with: npm run test:deploy

import { deploy, deployStatus, getStatus } from "../src/api/client";
import { signDeploy } from "../src/api/sign";
import { formatRhoResult } from "../src/api/rho-json";
import type { DeployData, RhoExpr } from "../src/api/types";

const HTTP = "http://localhost:40403";
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

async function deployTerm(term: string): Promise<RhoExpr[]> {
    const status = await getStatus(HTTP);
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

    for (let i = 0; i < 20; i++) {
        const st = await deployStatus(HTTP, deployId);
        if ("ProcessedWithSuccess" in st) return st.ProcessedWithSuccess.deployResult;
        if ("ProcessedWithError" in st) throw new Error(st.ProcessedWithError.deployError);
        await sleep(3000);
    }
    throw new Error("deploy timed out");
}

async function main() {
    // Int result
    const intExpr = await deployTerm('new deployId(`rho:rchain:deployId`) in { deployId!(42) }');
    check(formatRhoResult(intExpr) === "[\n  42\n]", `deploy Int -> Output JSON (${formatRhoResult(intExpr)?.replace(/\n/g, "\\n")})`);

    // String result
    const strExpr = await deployTerm('new deployId(`rho:rchain:deployId`) in { deployId!("hello") }');
    check(formatRhoResult(strExpr) === '[\n  "hello"\n]', "deploy String -> Output JSON");

    // Tuple result
    const tupleExpr = await deployTerm('new deployId(`rho:rchain:deployId`) in { deployId!((true, "done")) }');
    check(formatRhoResult(tupleExpr) === '[\n  [\n    true,\n    "done"\n  ]\n]', "deploy Tuple -> Output JSON");

    // Map result
    const mapExpr = await deployTerm('new deployId(`rho:rchain:deployId`) in { deployId!({"a": 1}) }');
    check(formatRhoResult(mapExpr) === '[\n  {\n    "a": 1\n  }\n]', "deploy Map -> Output JSON");

    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
