// noindex
// Integration seam: exposes `check_balance`, `transfer`, `deploy`, `explore`,
// `propose` for `globals.ts` and the UI, backed by the typed client in `src/api`.
// Deploy/transfer submit-and-track (non-blocking): they return the deploy id and
// record a pending transaction; the transaction view polls `deploy-status`.

import * as u from './utils';
import * as rho from './rho';
import { add_tx } from './transactions';
import {
    deploy as apiDeploy,
    exploreDeploy,
    getStatus,
    propose as apiPropose,
} from '../api/client';
import { signDeploy } from '../api/sign';
import type {
    BalanceResult,
    DeployRequest,
    DeployResult,
    ExploreResult,
    ProposeResult,
    TransferResult,
} from '../api/types';

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

export async function check_balance(
    readonly_url: string,
    rev_addr: string
): Promise<BalanceResult> {
    const code = rho.fn_check_balance(rev_addr);

    try {
        const res = await exploreDeploy(readonly_url, code);
        const expr = res.expr[0];
        if (!expr) {
            return { balance: null, error: "Unknown error" };
        }

        const balance = "ExprInt" in expr ? expr.ExprInt : null;
        const err = "ExprString" in expr ? expr.ExprString : null;

        return { balance, error: err };
    } catch (err) {
        return { balance: null, error: String(err) };
    }
}

export async function transfer(
    node_url: string,
    from_wallet: u.NamedWallet,
    to_wallet: u.NamedWallet,
    amount: number
): Promise<TransferResult> {
    u.wallet_normalize(from_wallet);
    u.wallet_normalize(to_wallet);
    const code = rho.fn_transfer_funds(to_wallet.revAddr, amount);

    let deployId: string;
    try {
        ({ deployId } = await sendDeploy(node_url, from_wallet, code, 500000));
    } catch (err) {
        return { deployId: null, error: String(err) };
    }

    add_tx({
        deployId,
        kind: "transfer",
        description: `Transfer ${amount / 100000000} REV to ${to_wallet.name || to_wallet.revAddr}`,
        timestamp: Date.now(),
        status: "pending",
    });

    return { deployId, error: null };
}

export async function deploy(
    node_url: string,
    wallet: u.NamedWallet,
    code: string,
    phlo_limit: number
): Promise<DeployResult> {
    u.wallet_normalize(wallet);

    let deployId: string;
    try {
        ({ deployId } = await sendDeploy(node_url, wallet, code, phlo_limit));
    } catch (err) {
        console.log("Error", err);
        return { deployId: null, error: u.error_string(err) };
    }

    add_tx({
        deployId,
        kind: "deploy",
        description: "Deploy rholang",
        timestamp: Date.now(),
        status: "pending",
    });

    return { deployId, error: null };
}

export async function explore(
    readonly_url: string,
    code: string,
): Promise<ExploreResult> {
    try {
        const res = await exploreDeploy(readonly_url, code);
        const expr = res.expr;
        if (!expr) {
            return { expr: null, error: "Unknown error" };
        }
        return { expr, error: null };
    } catch (err) {
        return { expr: null, error: String(err) };
    }
}

export async function propose(
    admin_url: string
): Promise<ProposeResult> {
    try {
        const res = await apiPropose(admin_url);
        return { expr: res, error: null };
    } catch (err) {
        return { expr: null, error: String(err) };
    }
}
