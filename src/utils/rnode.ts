// noindex
// Integration seam: exposes `check_balance`, `transfer`, `deploy`, `explore`,
// `propose` for `globals.ts` and the UI, backed by the typed client in `src/api`.
// Deploy/transfer submit-and-track (non-blocking): they return the deploy id and
// record a pending transaction; the transaction view polls `deploy-status`.

import * as u from './utils';
import * as rho from './rho';
import * as bc from './blockchain';
import { add_tx, type TxKind } from './transactions';
import { mark_revealed } from './exposure';
import {
    deploy as apiDeploy,
    deployStatus,
    exploreDeploy,
    getStatus,
    propose as apiPropose,
} from '../api/client';
import { rhoExprToJson, unwrap_payload } from '../api/rho-json';
import { signDeploy } from '../api/sign';
import type {
    BalanceResult,
    DeployData,
    DeployRequest,
    DeployResult,
    ExploreResult,
    PosInfoResult,
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
    attachments: string[] = []
): Promise<SignedDeploy> {
    if (!account.privKey) {
        throw new Error("Selected account doesn't have private key and cannot be used for signing.");
    }

    // Take the shard id from the node (its full id, e.g. `/root`) rather than hardcoding a bare
    // shard name: the node rejects a deploy whose `shardId` is not its own.
    const { latestBlockNumber, minPhloPrice, shardId } = await getStatus(url);
    const deployData: DeployData = {
        term: code,
        timestamp: Date.now(),
        phloPrice: Math.max(1, minPhloPrice),
        phloLimit,
        validAfterBlockNumber: latestBlockNumber,
        shardId,
    };
    if (attachments.length > 0) {
        deployData.attachments = attachments;
    }

    const signed = signDeploy(deployData, account.privKey);
    // The signed deploy carries the public key (`deployer`), so from here on the key is public
    // (src/utils/exposure.ts). Recorded before sending: a deploy whose response is lost may still
    // have reached the node. The deploy id is the signature.
    mark_revealed(signed.deployer, { source: "signed-here", deployId: signed.signature });
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

        // Both scalars arrive enveloped (`{"ExprInt":{"data":0}}`); `unwrap_payload` also tolerates
        // the bare form an early revision of the port sent. See src/api/types.ts.
        const balance = "ExprInt" in expr ? unwrap_payload(expr.ExprInt) : null;
        const err = "ExprString" in expr ? unwrap_payload(expr.ExprString) : null;

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

// Shared submit-and-track path for every signed operation: sign + POST the deploy, record a pending
// transaction of `kind`, then poll `deploy-status` to a terminal state. `deploy`, `bond`, `unbond`
// and `trust_key` differ only in the term and the transaction label.
async function run_deploy(
    node_url: string,
    wallet: u.NamedWallet,
    code: string,
    phlo_limit: number,
    kind: TxKind,
    description: string,
    attachments: string[] = []
): Promise<DeployResult> {
    u.wallet_normalize(wallet);

    let deployId: string;
    try {
        ({ deployId } = await sendDeploy(node_url, wallet, code, phlo_limit, attachments));
    } catch (err) {
        console.log("Error", err);
        return { deployId: null, expr: null, error: u.error_string(err) };
    }

    add_tx({
        deployId,
        kind,
        description,
        timestamp: Date.now(),
        status: "pending",
    });

    // Poll deploy-status to a terminal state and surface the deploy's returned result so the
    // Deploy "Output" box can show the JSON (mirrors the faucet submit-and-track loop).
    //
    // `NotProcessed` is not one situation but three (node's block_api_impl.rs): "Pooled" (accepted,
    // awaiting a block), "Block not yet available" (block exists but is not readable yet) and
    // "Unknown" (this node's DAG has no record of the id). Only the first two are worth waiting on.
    // An "Unknown" that never flips used to consume the whole timeout and then report "timed out",
    // which hid both the real reason and the fact that no result was ever coming.
    let last_status = "pending";
    let unknown_streak = 0;

    for (let i = 0; i < 60; i++) {
        let st;
        try {
            st = await deployStatus(node_url, deployId);
        } catch (err) {
            return { deployId, expr: null, error: u.error_string(err) };
        }

        if ("ProcessedWithSuccess" in st) {
            return { deployId, expr: st.ProcessedWithSuccess.deployResult, error: null };
        }
        if ("ProcessedWithError" in st) {
            return { deployId, expr: null, error: st.ProcessedWithError.deployError };
        }

        last_status = st.NotProcessed.status;
        unknown_streak = last_status === "Unknown" ? unknown_streak + 1 : 0;

        // Tolerate a short run of "Unknown" (a node can answer that before it indexes a fresh
        // deploy), but do not spend the full timeout on one this node will never resolve.
        if (unknown_streak >= 5) {
            return {
                deployId,
                expr: null,
                error: `Deploy ${deployId} is unknown to this node: it has no record of the id, `
                    + `so no result is available (status "${last_status}" after `
                    + `${unknown_streak} polls).`,
            };
        }

        await new Promise(r => setTimeout(r, 3000));
    }

    return {
        deployId,
        expr: null,
        error: `Timed out waiting for deploy result (last status: "${last_status}").`,
    };
}

export async function deploy(
    node_url: string,
    wallet: u.NamedWallet,
    code: string,
    phlo_limit: number,
    attachments: string[] = []
): Promise<DeployResult> {
    return run_deploy(
        node_url, wallet, code, phlo_limit, "deploy",
        attachments.length > 0
            ? `Deploy rholang (+${attachments.length} attachment${attachments.length === 1 ? "" : "s"})`
            : "Deploy rholang",
        attachments
    );
}

// --- Quantum key hygiene ------------------------------------------------------
// Move the whole balance of `wallet` to `to_rev_addr` in one deploy (`rho.fn_sweep`). The caller is
// responsible for `to_rev_addr` being fresh — a key that has never signed — and for its private key
// being saved before this is called; see the Dashboard's sweep action.
export async function sweep(
    node_url: string,
    wallet: u.NamedWallet & { privKey?: string },
    to_rev_addr: string
): Promise<DeployResult> {
    if (!wallet.privKey) {
        return { deployId: null, expr: null, error: "Selected account doesn't have private key and cannot be used for signing." };
    }
    // The address `getBalance` reads must be the vault `transfer` spends, which is derived from the
    // signing key — so derive it from the key rather than trust the stored `revAddr`.
    const from = await bc.get_account_from_private_key(wallet.privKey);
    if (!from) {
        return { deployId: null, expr: null, error: "Could not derive this account's address from its key." };
    }
    if (!(await bc.is_valid_rev_address(to_rev_addr))) {
        return { deployId: null, expr: null, error: `Not a valid address: ${to_rev_addr}` };
    }
    if (to_rev_addr === from.revAddr) {
        return { deployId: null, expr: null, error: "The sweep target is this account's own address." };
    }
    return run_deploy(
        node_url, wallet, rho.fn_sweep(from.revAddr, to_rev_addr), SWEEP_PHLO_LIMIT, "sweep",
        `Sweep whole balance to ${to_rev_addr.slice(0, 12)}…`
    );
}

/**
 * Phlo limit for a sweep. The unused part is refunded to the *old* address after the deploy, so this
 * bounds the dust left behind: at a phlo price of 1 it is at most 0.005 REV.
 */
export const SWEEP_PHLO_LIMIT = 500000;

// --- Proof of Stake -----------------------------------------------------------
// Self-bond/unbond via the native `rho:rchain:pos`. Both take the caller's own `deployerId`, so
// `wallet` must be a signing account (not MetaMask). These return the deploy's result, whose first
// element is the PoS reply `(Bool, Nil|String)` — the caller surfaces the refusal reason verbatim.

export async function bond(
    node_url: string,
    wallet: u.NamedWallet,
    amount: number
): Promise<DeployResult> {
    return run_deploy(
        node_url, wallet, rho.fn_bond(amount), 500000, "bond",
        `Bond ${amount / 100000000} REV`
    );
}

export async function unbond(
    node_url: string,
    wallet: u.NamedWallet
): Promise<DeployResult> {
    return run_deploy(node_url, wallet, rho.fn_unbond(), 500000, "unbond", "Stage withdrawal (unbond)");
}

// Admit (`trust`) or remove (`untrust`) a 65-byte validator public key. Only a trusted stakeholder
// may do this; it is the only way a fresh key becomes bondable.
export async function trust_key(
    node_url: string,
    wallet: u.NamedWallet,
    pubkey_hex: string,
    op: "trust" | "untrust"
): Promise<DeployResult> {
    const label = op === "trust" ? "Trust" : "Untrust";
    return run_deploy(
        node_url, wallet, rho.fn_trust(pubkey_hex, op), 500000, "trust",
        `${label} key ${pubkey_hex.slice(0, 10)}…`
    );
}

// Delegate `amount` REV from this account's own vault onto `operator_pubkey`'s bond (law 57). Any
// bonded operator is delegable-to; no trust or admission step is needed to delegate.
export async function delegate(
    node_url: string,
    wallet: u.NamedWallet,
    operator_pubkey_hex: string,
    amount: number
): Promise<DeployResult> {
    return run_deploy(
        node_url, wallet, rho.fn_delegate(operator_pubkey_hex, amount), 500000, "delegate",
        `Delegate ${amount / 100000000} REV to ${operator_pubkey_hex.slice(0, 10)}…`
    );
}

// Stage an undelegation from `operator_pubkey`. Staged until the boundary, then quarantined, then
// paid `principal + accrued rewards` to this account's vault.
export async function undelegate(
    node_url: string,
    wallet: u.NamedWallet,
    operator_pubkey_hex: string
): Promise<DeployResult> {
    return run_deploy(
        node_url, wallet, rho.fn_undelegate(operator_pubkey_hex), 500000, "undelegate",
        `Undelegate from ${operator_pubkey_hex.slice(0, 10)}…`
    );
}

// Read this account's PoS position: its bond (null when unbonded) and whether its key is trusted.
// Explores `fn_pos_info`, whose reply is a scalar pair `(Int, Bool)`.
export async function check_pos(
    readonly_url: string,
    pubkey_hex: string
): Promise<PosInfoResult> {
    const code = rho.fn_pos_info(pubkey_hex);

    try {
        const res = await exploreDeploy(readonly_url, code);
        const first = res.expr?.[0];
        if (!first) {
            return { bonded: null, trusted: false, error: "Unknown error" };
        }

        const json = rhoExprToJson(first);
        if (!Array.isArray(json)) {
            return { bonded: null, trusted: false, error: "Unexpected PoS read result" };
        }

        const [bonded_v, trusted_v] = json;
        const bonded = typeof bonded_v === "number" && bonded_v >= 0 ? bonded_v : null;
        return { bonded, trusted: trusted_v === true, error: null };
    } catch (err) {
        return { bonded: null, trusted: false, error: String(err) };
    }
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
