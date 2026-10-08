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
// This file answers the first half: "is this key revealed?". There are three sources of evidence:
//   1. this wallet signed a deploy with the key (recorded by `mark_revealed`, called from the signing
//      path in rnode.ts before the deploy is sent);
//   2. the node's deploy pool holds a deploy from the key (`GET /api/v1/deploys`);
//   3. the node's deployer index (`GET /api/v1/deployer/{hash}`): a block containing a deploy the
//      key signed, in one lookup. The wallet asks by `blake2b256(public key)`, never by the key: a
//      key that has not signed is still private, and sending it to the node would publish it. The
//      index reaches down to `indexedFromHeight`; a node upgraded onto an existing chain backfills
//      the blocks below that in the background, and a node that joined by state sync never holds
//      them. Either way "not seen" cannot be said below that height — the answer is "partial", not
//      a guess.
// A revealed key is remembered for good, because a key that has been published cannot be
// unpublished. A node without the index is "unknown": the wallet does not scan the chain instead.

import blake from 'blakejs';
import * as u from './utils';
import { getDeployer, getPooledDeploys } from '../api/client';

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
     * No block this node holds contains a deploy from the key, and the pool holds none. With
     * `poolUnread` the pool could not be read, so a deploy waiting there is not ruled out.
     */
    | { state: "not-seen"; poolUnread?: true }
    /** Not in any block from `indexedFrom` up; the node has not indexed, or does not hold, the blocks below. */
    | { state: "indexing"; indexedFrom: number; poolUnread?: true }
    | { state: "unknown"; error: string };

/** The default warning threshold, in REV. Configurable on the Settings page. */
export const DEFAULT_THRESHOLD_REV = 10;
export const DROPS_PER_REV = 100_000_000;

/**
 * What the deployer index is keyed by, and what the wallet sends: `blake2b256` of the 65-byte key,
 * as hex. It does not reveal the key, so checking an unused key leaves it unused.
 */
export function deployer_key_hash(pub_key: string): string {
    const bytes = Uint8Array.from(normalize_key(pub_key).match(/../g) ?? [], b => parseInt(b, 16));
    return blake.blake2bHex(bytes, undefined, 32);
}

/** Public keys as the node writes them: bare lowercase hex. */
export function normalize_key(pub_key: string): string {
    return pub_key.replace(/^0x/i, "").toLowerCase();
}

// --- What the wallet remembers --------------------------------------------------------------------
//
// Kept in memory and mirrored to localStorage (like `tx_list`), so it works where localStorage does
// not exist (the tsx unit tests) and survives a reload where it does.

export const revealed_keys: Record<string, RevealRecord> = {};

export function restore_exposure_state() {
    Object.assign(revealed_keys, u.get_local("revealed-keys", {}));
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

/**
 * Is `pub_key` revealed, as far as this wallet and `node_url` can tell? A remembered reveal answers
 * at once; otherwise the pool, then the node's deployer index. A positive finding is remembered.
 */
export async function check_exposure(node_url: string, pub_key: string): Promise<Exposure> {
    const key = normalize_key(pub_key);
    const known = revealed_keys[key];
    if (known) return { state: "revealed", record: known };

    try {
        // The pool first: it catches a deploy signed elsewhere that is not in a block yet. A pool that
        // cannot be read does not stop the index lookup (a block hit is still conclusive), but a
        // negative answer then says the pool went unchecked rather than passing for a full one.
        let pool_unread = false;
        try {
            const pool = await getPooledDeploys(node_url);
            const hit = pool.deploys.find(d => normalize_key(d.deployer) === key);
            if (hit) {
                mark_revealed(key, { source: "pool", deployId: hit.deployId });
                return { state: "revealed", record: revealed_keys[key] };
            }
        } catch {
            pool_unread = true;
        }

        const info = await getDeployer(node_url, deployer_key_hash(key));
        if (info === null) {
            return { state: "unknown", error: "this node has no deployer index (GET /api/v1/deployer)" };
        }
        if (info.block) {
            mark_revealed(key, {
                source: "chain",
                blockNumber: info.block.blockNumber,
                blockHash: info.block.blockHash,
            });
            return { state: "revealed", record: revealed_keys[key] };
        }
        const pool = pool_unread ? { poolUnread: true as const } : {};
        return info.indexedFromHeight > 0
            ? { state: "indexing", indexedFrom: info.indexedFromHeight, ...pool }
            : { state: "not-seen", ...pool };
    } catch (err) {
        return { state: "unknown", error: u.error_string(err) };
    }
}

/**
 * Wraps a check so that only the most recent call's result is used: an earlier call that resolves
 * later returns `null`, as does any call pending when `cancel` runs. The panel uses it so that a
 * slow check for the previous account or node never lands on the current one.
 */
export function latest_only<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
    let seq = 0;
    return {
        run: async (...args: A): Promise<R | null> => {
            const mine = ++seq;
            const result = await fn(...args);
            return mine === seq ? result : null;
        },
        cancel: () => { seq++; },
    };
}

const POOL_UNREAD_NOTE = " The node's deploy pool could not be read, so a deploy still waiting there would not show.";

/** One line for the UI. */
export function describe_exposure(exposure: Exposure): string {
    return describe_state(exposure)
        + ((exposure.state === "not-seen" || exposure.state === "indexing") && exposure.poolUnread ? POOL_UNREAD_NOTE : "");
}

function describe_state(exposure: Exposure): string {
    switch (exposure.state) {
        case "revealed": {
            const r = exposure.record;
            if (r.source === "signed-here") return "Public key revealed: this wallet signed a deploy with it.";
            if (r.source === "pool") return "Public key revealed: a deploy from this key is waiting in the node's pool.";
            return `Public key revealed: a deploy from this key is in block ${r.blockNumber}.`;
        }
        case "not-seen":
            return "Public key not seen: no block on this node carries a deploy it signed.";
        case "indexing":
            return `Public key not seen in this node's blocks from ${exposure.indexedFrom} up. It has not indexed `
                + "or does not hold the older blocks; check again later, or ask a node that holds the whole chain.";
        case "unknown":
            return `Could not check whether the public key is revealed: ${exposure.error}`;
    }
}
