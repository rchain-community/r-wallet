// Quantum key hygiene: has this account's public key been revealed, and should its REV move?
//
// The rchain-rust post-quantum plan (docs/src/contributor/post-quantum-plan.md §16.1) puts address
// hygiene in the wallet. A REV address is a hash of the public key, so an address that has only ever
// *received* REV does not reveal its key. The key becomes public the first time it signs a deploy:
// the deploy carries it in `deployer`, and every block that includes the deploy stores it. From then
// on, an attacker with a large enough quantum computer could derive the private key and spend the
// vault. The defence that works today is to keep value behind an unrevealed key, and to leave a
// revealed one by sweeping the whole balance to a fresh address in one deploy.
//
// This file answers the first half: "is this key revealed?". There are three sources of evidence,
// and only a positive one is conclusive:
//   1. this wallet signed a deploy with the key (recorded by `mark_revealed`, called from the signing
//      path in rnode.ts before the deploy is sent);
//   2. the node's deploy pool holds a deploy from the key (`GET /api/v1/deploys`);
//   3. a block on the chain contains a deploy from the key (`GET /api/blocks/{start}/{end}`, then
//      `GET /api/block/{hash}` for each block that has deploys).
// The node keeps no index by deployer, so (3) is a scan. It is incremental: the highest height
// already scanned is cached per node and key, and a revealed key is remembered for good, because a
// key that has been published cannot be unpublished. "Not seen" is reported with the range scanned,
// never as "safe".

import * as u from './utils';
import { getBlock, getBlocksByHeights, getPooledDeploys, getStatus } from '../api/client';

export type RevealSource = "signed-here" | "pool" | "chain";

export interface RevealRecord {
    /** How the wallet learned the key was revealed. */
    source: RevealSource;
    /** When the wallet recorded it (ms since the epoch). */
    recordedAt: number;
    deployId?: string;
    blockNumber?: number;
    blockHash?: string;
}

export type Exposure =
    | { state: "revealed"; record: RevealRecord }
    /**
     * No deploy from the key was found in heights `0..=scannedTo`, nor in the pool. `complete` is
     * false when the per-check budget ran out before the head (`latest`); checking again continues.
     */
    | { state: "not-seen"; scannedTo: number; latest: number; complete: boolean }
    | { state: "unknown"; error: string };

/** The node refuses a height range wider than its `max-blocks-limit` (50 by default). */
export const HEIGHT_CHUNK = 50;
/** How many heights one check scans at most, so a long chain is not walked in one go. */
export const DEFAULT_SCAN_BUDGET = 2000;
/** The default warning threshold, in REV. Configurable on the Settings page. */
export const DEFAULT_THRESHOLD_REV = 10;
export const DROPS_PER_REV = 100_000_000;

/** Public keys as the node writes them: bare lowercase hex. */
export function normalize_key(pub_key: string): string {
    return pub_key.replace(/^0x/i, "").toLowerCase();
}

// --- What the wallet remembers --------------------------------------------------------------------
//
// Kept in memory and mirrored to localStorage (like `tx_list`), so it works where localStorage does
// not exist (the tsx unit tests) and survives a reload where it does.

export const revealed_keys: Record<string, RevealRecord> = {};
const scan_progress: Record<string, number> = {};

export function restore_exposure_state() {
    Object.assign(revealed_keys, u.get_local("revealed-keys", {}));
    Object.assign(scan_progress, u.get_local("exposure-scan", {}));
}

/** Record that `pub_key` is public. The earliest record wins: it is the most informative. */
export function mark_revealed(pub_key: string, record: Omit<RevealRecord, "recordedAt">) {
    const key = normalize_key(pub_key);
    if (revealed_keys[key]) return;
    revealed_keys[key] = { ...record, recordedAt: Date.now() };
    u.set_local("revealed-keys", revealed_keys);
}

export function known_reveal(pub_key: string): RevealRecord | null {
    return revealed_keys[normalize_key(pub_key)] ?? null;
}

function scan_key(node_url: string, pub_key: string) {
    return `${node_url.replace(/\/$/, "")}|${normalize_key(pub_key)}`;
}

/** Forget scan progress (not reveals) — for tests, and for a node whose chain was reset. */
export function reset_scan_progress() {
    for (const k of Object.keys(scan_progress)) delete scan_progress[k];
    u.set_local("exposure-scan", scan_progress);
}

// --- Threshold ----------------------------------------------------------------------------------

export function get_threshold_rev(): number {
    const v = u.get_local("exposure-threshold");
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_THRESHOLD_REV;
}

export function set_threshold_rev(rev: number) {
    if (!Number.isFinite(rev) || rev < 0) return;
    u.set_local("exposure-threshold", rev);
}

/**
 * Whether to warn. Only a *revealed* key above the threshold warns: an unrevealed key is the safe
 * place for value, and a revealed one holding dust is not worth a sweep's phlo.
 */
export function should_warn(exposure: Exposure, balance_drops: number | null, threshold_rev: number): boolean {
    if (exposure.state !== "revealed") return false;
    if (balance_drops === null) return false;
    return balance_drops > threshold_rev * DROPS_PER_REV;
}

// --- The check ----------------------------------------------------------------------------------

export interface CheckOptions {
    /** Most heights to scan in this call. */
    budget?: number;
}

/**
 * Is `pub_key` revealed, as far as this wallet and `node_url` can tell?
 *
 * A remembered reveal answers at once. Otherwise the pool is checked, then the chain is scanned
 * upward from where the last check stopped. A positive finding is remembered.
 */
export async function check_exposure(node_url: string, pub_key: string, opts: CheckOptions = {}): Promise<Exposure> {
    const key = normalize_key(pub_key);
    const known = revealed_keys[key];
    if (known) return { state: "revealed", record: known };

    const budget = Math.max(1, opts.budget ?? DEFAULT_SCAN_BUDGET);

    try {
        // The pool first: cheap, and it catches a deploy signed elsewhere that is not in a block yet.
        try {
            const pool = await getPooledDeploys(node_url);
            const hit = pool.deploys.find(d => normalize_key(d.deployer) === key);
            if (hit) {
                mark_revealed(key, { source: "pool", deployId: hit.deployId });
                return { state: "revealed", record: revealed_keys[key] };
            }
        } catch {
            // A node without `/api/v1/deploys` still answers the chain scan.
        }

        const { latestBlockNumber: latest } = await getStatus(node_url);
        const sk = scan_key(node_url, key);
        // A cached height above the head means the chain was reset under this URL (a devnet
        // restart): start again from genesis rather than trust the old progress.
        let done = scan_progress[sk] ?? -1;
        if (done > latest) done = -1;

        const stop = Math.min(latest, done + budget);
        for (let start = done + 1; start <= stop; start += HEIGHT_CHUNK) {
            const end = Math.min(stop, start + HEIGHT_CHUNK - 1);
            const blocks = await getBlocksByHeights(node_url, start, end);
            for (const b of blocks) {
                if (!b.deployCount) continue;
                const full = await getBlock(node_url, b.blockHash);
                const d = full.deploys.find(d => normalize_key(d.deployer) === key);
                if (d) {
                    mark_revealed(key, {
                        source: "chain",
                        blockNumber: b.blockNumber,
                        blockHash: b.blockHash,
                    });
                    return { state: "revealed", record: revealed_keys[key] };
                }
            }
            scan_progress[sk] = end;
            u.set_local("exposure-scan", scan_progress);
        }

        const scannedTo = Math.max(done, stop);
        return { state: "not-seen", scannedTo, latest, complete: scannedTo >= latest };
    } catch (err) {
        return { state: "unknown", error: u.error_string(err) };
    }
}

/** One line for the UI. */
export function describe_exposure(exposure: Exposure): string {
    switch (exposure.state) {
        case "revealed": {
            const r = exposure.record;
            if (r.source === "signed-here") return "Public key revealed: this wallet signed a deploy with it.";
            if (r.source === "pool") return "Public key revealed: a deploy from this key is waiting in the node's pool.";
            return `Public key revealed: a deploy from this key is in block ${r.blockNumber}.`;
        }
        case "not-seen":
            return exposure.complete
                ? `Public key not seen on chain (blocks 0–${exposure.scannedTo} checked).`
                : `Public key not seen in blocks 0–${exposure.scannedTo} of ${exposure.latest}; check again to continue.`;
        case "unknown":
            return `Could not check whether the public key is revealed: ${exposure.error}`;
    }
}
