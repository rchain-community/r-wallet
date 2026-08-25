// noindex
// Integration seam: exposes the same public functions (`check_balance`, `transfer`,
// `deploy`, `explore`, `propose`) that `globals.ts` and UI callers depend on,
// now backed by the first-party Rust RNode HTTP client in `src/api`.

import * as u from './utils';
import * as rho from './rho';
import {
    deploy as apiDeploy,
    deployStatus,
    exploreDeploy,
    getBlock,
    getStatus,
    propose as apiPropose,
} from '../api/client';
import { signDeploy } from '../api/sign';
import { rhoExprToJson } from '../api/rho-json';
import type { DeployRequest } from '../api/types';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface SignedDeploy {
    deployId: string;
    signed: DeployRequest;
}

async function sendDeploy(
    url: string,
    account: u.NamedWallet & { privKey?: string },
    code: string,
    phloLimit = 500000,
    shardId = "root"
): Promise<SignedDeploy> {
    if (!account.privKey) {
        throw new Error("Selected account doesn't have private key and cannot be used for signing.");
    }

    const { latestBlockNumber, minPhloPrice } = await getStatus(url);
    const deployData = {
        term: code,
        timestamp: Date.now(),
        phloPrice: Math.max(1, minPhloPrice),
        phloLimit,
        validAfterBlockNumber: latestBlockNumber,
        shardId,
    };

    const signed = signDeploy(deployData, account.privKey);
    const deployId = await apiDeploy(url, signed);
    return { deployId, signed };
}

async function getDataForDeploy(
    url: string,
    deployId: string,
    cancel: () => boolean = () => false
): Promise<{ data: { expr: any } | null; cost: number | null }> {
    for (;;) {
        const st = await deployStatus(url, deployId);

        if ("ProcessedWithSuccess" in st) {
            const { deployResult, block } = st.ProcessedWithSuccess;
            let cost: number | null = null;
            try {
                const blockInfo = await getBlock(url, block.blockHash);
                const deployInfo = blockInfo.deploys.find(d => d.sig === deployId);
                if (deployInfo) cost = deployInfo.cost;
            } catch {
                // cost is best-effort; the result expression is what matters
            }
            const expr = deployResult && deployResult.length > 0 ? deployResult[0] : null;
            return { data: expr == null ? null : { expr }, cost };
        }

        if ("ProcessedWithError" in st) {
            throw new Error(st.ProcessedWithError.deployError);
        }

        if (cancel()) {
            throw new Error("Deploy polling cancelled.");
        }
        await sleep(3000);
    }
}

export async function check_balance(
    readonly_url: string,
    rev_addr: string
) {
    const code = rho.fn_check_balance(rev_addr);

    try {
        const res = await exploreDeploy(readonly_url, code);
        const expr = res.expr[0];
        if (!expr) {
            return { balance: null, error: "Unknown error" };
        }

        const balance = (expr as any).ExprInt as number | undefined;
        const err = (expr as any).ExprString as string | undefined;

        return {
            balance: balance ?? null,
            error: err ?? null
        };
    } catch (err) {
        return {
            balance: null,
            error: String(err)
        };
    }
}

export async function transfer(
    node_url: string,
    from_wallet: u.NamedWallet,
    to_wallet: u.NamedWallet,
    amount: number,
    cancel: ()=>boolean = ()=>false
) {
    u.wallet_normalize(from_wallet);
    u.wallet_normalize(to_wallet);
    const code = rho.fn_transfer_funds(from_wallet.revAddr, to_wallet.revAddr, amount);

    let deployId: string;
    try {
        ({ deployId } = await sendDeploy(node_url, from_wallet, code, 500000));
    } catch (err) {
        return {
            cost: null,
            error: String(err)
        };
    }

    let data: any;
    let cost: number | null;
    try {
        let res = await getDataForDeploy(node_url, deployId, cancel);
        data = res.data;
        cost = res.cost;
    } catch (err) {
        return {
            cost: null,
            error: String(err)
        };
    }

    const args = data ? rhoExprToJson(data.expr) : null;

    if (!args) {
        return {
            cost: null,
            error: "Deploy found in the block, but failed to get confirmation data."
        };
    }

    if (!args[0]) {
        return {
            cost: cost || null,
            error: args[1] || args[0]
        };
    }

    return {
        cost: cost,
        error: null
    };
}

export async function deploy(
    node_url: string,
    wallet: u.NamedWallet,
    code: string,
    phlo_limit: number,
    cancel: ()=>boolean = ()=>false
) {
    u.wallet_normalize(wallet);

    let deployId: string;
    try {
        ({ deployId } = await sendDeploy(node_url, wallet, code, phlo_limit));
    } catch (err) {
        console.log("Error", err);
        return {
            message: null,
            cost: null,
            error: u.error_string(err)
        };
    }

    let data: any;
    let cost: number | null;
    try {
        let res = await getDataForDeploy(node_url, deployId, cancel);
        data = res.data;
        cost = res.cost;
    } catch (err) {
        console.log("Error", err);
        return {
            message: null,
            cost: null,
            error: u.error_string(err)
        };
    }

    const args = data ? rhoExprToJson(data.expr) : null;

    if (!args) {
        return {
            message: null,
            cost: cost || null,
            error: "Deploy found in the block, but data is not sent on `rho:rchain:deployId` channel."
        };
    }

    return {
        message: u.is_type(args, Array) ? args.join(", ") : args,
        cost: cost || null,
        error: null
    };
}

export async function explore(
    readonly_url: string,
    code: string,
) {
    try {
        const res = await exploreDeploy(readonly_url, code);

        const expr = res.expr;
        if (!expr) {
            return { expr: null, error: "Unknown error" };
        }

        return { expr, error: null };

    } catch (err) {
        return {
            expr: null,
            error: String(err)
        };
    }
}

export async function propose(
    admin_url: string
) {
    try {
        const res = await apiPropose(admin_url);
        return { expr: res, error: null };
    } catch (err) {
        return {
            expr: null,
            error: String(err)
        };
    }
}
