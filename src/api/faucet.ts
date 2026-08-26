// Dev faucet: call the node's native `POST /api/faucet` endpoint (the node signs
// a transfer from its funded devnet deployer key server-side), then poll
// deploy-status until the transfer is processed. Dev/test only.

import { faucetRequest, deployStatus } from "./client";
import type { FaucetResult } from "./types";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function faucet(url: string, toRevAddr: string): Promise<FaucetResult> {
    const { deployId } = await faucetRequest(url, toRevAddr);

    for (;;) {
        const st = await deployStatus(url, deployId);
        if ("ProcessedWithSuccess" in st) return { deployId };
        if ("ProcessedWithError" in st) throw new Error(st.ProcessedWithError.deployError);
        // NotProcessed — retry (the node proposes on deploy / autopropose)
        await sleep(3000);
    }
}
