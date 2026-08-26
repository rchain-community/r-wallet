// Local tracking of submitted deploys. The node has no endpoint to list pooled
// deploys, so the wallet records each submission and polls `deploy-status` to
// move it from "pending" to "finalized"/"failed".

import * as u from './utils';
import { deployStatus, getPooledDeploys } from '../api/client';

export type TxKind = "deploy" | "transfer" | "faucet";
export type TxStatus = "pending" | "finalized" | "failed";

export interface TransactionRecord {
    deployId: string;
    kind: TxKind;
    description: string;
    timestamp: number;
    status: TxStatus;
    error?: string | null;
}

export let tx_list: TransactionRecord[] = [];

export function restore_tx_list() {
    const stored = u.get_local('tx-list', []);
    if (stored) tx_list.push(...stored);
}

export function add_tx(record: TransactionRecord) {
    tx_list.unshift(record);
    u.set_local('tx-list', tx_list);
}

export async function refresh_tx_states(url: string) {
    let changed = false;

    // Reconcile with the node's pool: surface any pooled deploy we don't already
    // track (e.g. from another session/device), as a pending "deploy" record.
    try {
        const pool = await getPooledDeploys(url);
        const known = new Set(tx_list.map(t => t.deployId));
        for (const d of pool.deploys) {
            if (known.has(d.deployId)) continue;
            const term = d.term ?? "";
            tx_list.unshift({
                deployId: d.deployId,
                kind: "deploy",
                description: `Deploy: ${term.slice(0, 40)}${term.length > 40 ? "…" : ""}`,
                timestamp: d.timestamp,
                status: "pending",
            });
            changed = true;
        }
    } catch {
        // node may not expose /api/v1/deploys yet — ignore
    }

    // Poll status for pending records.
    for (const tx of tx_list) {
        if (tx.status !== "pending") continue;
        try {
            const st = await deployStatus(url, tx.deployId);
            if ("ProcessedWithSuccess" in st) {
                tx.status = "finalized";
                changed = true;
            } else if ("ProcessedWithError" in st) {
                tx.status = "failed";
                tx.error = st.ProcessedWithError.deployError;
                changed = true;
            }
        } catch {
            // leave pending
        }
    }

    if (changed) u.set_local('tx-list', tx_list);
}
