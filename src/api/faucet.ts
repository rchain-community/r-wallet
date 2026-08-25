// Dev faucet: sign a transfer from the funded devnet deployer key to a target
// REV address, then poll until the deploy is processed. Dev/test only.

import * as bc from "../utils/blockchain";
import * as rho from "../utils/rho";
import { deploy, deployStatus, getStatus } from "./client";
import { signDeploy } from "./sign";
import type { FaucetConfig } from "../utils/networks";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function faucet(
    url: string,
    toRevAddr: string,
    config: FaucetConfig
): Promise<{ deployId: string }> {
    const deployer = await bc.get_account_from_private_key(config.privateKey);
    if (!deployer || !deployer.privKey) {
        throw new Error("Invalid faucet deployer private key.");
    }

    const fromRevAddr = config.revAddr || deployer.revAddr;
    const amount = config.amount * 100000000; // whole REV -> base units
    const code = rho.fn_transfer_funds(fromRevAddr, toRevAddr, amount);

    const { latestBlockNumber, minPhloPrice } = await getStatus(url);
    const signed = signDeploy(
        {
            term: code,
            timestamp: Date.now(),
            phloPrice: Math.max(1, minPhloPrice),
            phloLimit: 500000,
            validAfterBlockNumber: latestBlockNumber,
            shardId: "root",
        },
        deployer.privKey
    );

    const deployId = await deploy(url, signed);

    for (;;) {
        const st = await deployStatus(url, deployId);
        if ("ProcessedWithSuccess" in st) return { deployId };
        if ("ProcessedWithError" in st) throw new Error(st.ProcessedWithError.deployError);
        // NotProcessed — retry (devnet autoproposes)
        await sleep(3000);
    }
}
