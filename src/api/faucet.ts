// Dev faucet: call the node's native `POST /api/faucet` endpoint (the node signs
// a transfer from its funded devnet deployer key server-side). Dev/test only.
// Submits and tracks a pending transaction; the transaction view polls status.

import { faucetRequest } from "./client";
import { add_tx } from "../utils/transactions";
import type { FaucetResult } from "./types";

export async function faucet(url: string, toRevAddr: string): Promise<FaucetResult> {
    const { deployId, amount } = await faucetRequest(url, toRevAddr);

    add_tx({
        deployId,
        kind: "faucet",
        description: `Faucet ${amount / 100000000} REV to ${toRevAddr}`,
        timestamp: Date.now(),
        status: "pending",
    });

    return { deployId };
}
