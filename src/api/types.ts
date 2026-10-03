// Wire types for the RNode (Rust) HTTP API.
//
// Serde enums are externally tagged AND this port's variant payloads are field-structs, so
// `RhoExpr::ExprInt(42)` goes over the wire as `{"ExprInt":{"data":42}}`: the tag names the variant
// and the payload carries one field, `data`. That is the reference (Scala) node's shape as well —
// `legacy/node/src/main/scala/coop/rchain/node/api/json/JsonSchemaDerivation.scala` declares
// `final case class ExprInt(data: Long)` and serializes the field — so the envelope is the contract
// rather than a port quirk. Measured on a live node:
//   explore-deploy "42"          -> [{"ExprInt":{"data":42}}]
//   explore-deploy "{\"a\":\"b\"}" -> [{"ExprMap":{"data":{"a":{"ExprString":{"data":"b"}}}}}]
// `RhoPayload` admits the bare form too, because an early revision of this port emitted it and old
// recorded responses still parse. Consumers must not branch on the raw shape: read through
// `rhoExprToJson` (src/api/rho-json.ts), which unwraps either.

/** A variant payload: this port's (and the reference node's) `{data: T}`, or the bare `T`. */
export type RhoPayload<T> = T | { data: T };

export type RhoUnforg =
    | { UnforgPrivate: RhoPayload<string> }
    | { UnforgDeploy: RhoPayload<string> }
    | { UnforgDeployer: RhoPayload<string> };

/**
 * A dictionary. This port and the reference node send a JSON **object** of key -> RhoExpr (keys in
 * the canonical sorted order, the payload being a sorted map); an early revision of this port sent
 * `[[key, expr], …]`, which is still accepted.
 */
export type RhoMapPayload =
    | Record<string, RhoExpr>
    | { data: Record<string, RhoExpr> }
    | [string, RhoExpr][];

export type RhoExpr =
    | { ExprPar: RhoPayload<RhoExpr[]> }
    | { ExprTuple: RhoPayload<RhoExpr[]> }
    | { ExprList: RhoPayload<RhoExpr[]> }
    | { ExprSet: RhoPayload<RhoExpr[]> }
    | { ExprMap: RhoMapPayload }
    | { ExprBool: RhoPayload<boolean> }
    | { ExprInt: RhoPayload<number> }
    | { ExprString: RhoPayload<string> }
    | { ExprUri: RhoPayload<string> }
    | { ExprBytes: RhoPayload<string> }
    | { ExprUnforg: RhoPayload<RhoUnforg> };

export interface VersionInfo {
    api: string;
    node: string;
}

export interface ApiStatus {
    version: VersionInfo;
    address: string;
    networkId: string;
    shardId: string;
    peers: number;
    nodes: number;
    minPhloPrice: number;
    latestBlockNumber: number;
    // Capability flags. `/api/status` reports the same flags as
    // `GET /api/v1/capabilities`; see `NodeCapabilities` below.
    autopropose: boolean;
    proposeOnDeploy: boolean;
    manualPropose: boolean;
    adminHttp: boolean;
    devMode: boolean;
}

export interface BondInfo {
    validator: string;
    stake: number;
}

export interface LightBlockInfo {
    version: number;
    shardId: string;
    blockHash: string;
    blockNumber: number;
    sender: string;
    seqNum: number;
    preStateHash: string;
    postStateHash: string;
    justifications: string[];
    bonds: BondInfo[];
    sigAlgorithm: string;
    sig: string;
    blockSize: string;
    deployCount: number;
    rejectedDeploys: string[];
    // The proposer's informational wall-clock timestamp (ms since the Unix epoch), part of the
    // block header (so hash-covered) but not a consensus input. Exposed by the node's
    // `LightBlockInfo` and via `rho:block:data`.
    timestamp: number;
}

export interface DeployInfo {
    deployer: string;
    term: string;
    timestamp: number;
    sig: string;
    sigAlgorithm: string;
    phloPrice: number;
    phloLimit: number;
    validAfterBlockNumber: number;
    cost: number;
    errored: boolean;
    systemDeployError: string;
}

export interface BlockInfo {
    blockInfo: LightBlockInfo;
    deploys: DeployInfo[];
}

export interface DeployData {
    term: string;
    timestamp: number;
    phloPrice: number;
    phloLimit: number;
    validAfterBlockNumber: number;
    shardId: string;
    // Binary attachments (RCHIP #39), hex strings in order. Part of the *signed* deploy data and
    // exposed to rholang as `rho:attachment:1`, `rho:attachment:2`, … (1-based) → ByteArray.
    // Omitted for an ordinary deploy (whose bytes, signature and deploy id are unchanged).
    attachments?: string[];
}

export interface DeployRequest {
    data: DeployData;
    deployer: string;
    signature: string;
    sigAlgorithm: string;
}

export interface FaucetResponse {
    deployId: string;
    amount: number;
    to: string;
}

export interface NodeCapabilities {
    autopropose: boolean;
    proposeOnDeploy: boolean;
    manualPropose: boolean;
    adminHttp: boolean;
    devMode: boolean;
    faucet: boolean;
}

export interface PooledDeploy {
    deployId: string;
    timestamp: number;
    deployer: string;
    term: string;
    phloPrice: number;
    phloLimit: number;
    validAfterBlockNumber: number;
}

export interface PooledDeploys {
    deploys: PooledDeploy[];
}

export type DeployExecStatus =
    | { ProcessedWithSuccess: { deployResult: RhoExpr[]; block: LightBlockInfo } }
    | { ProcessedWithError: { deployError: string; block: LightBlockInfo } }
    | { NotProcessed: { status: string } };

export interface RhoExprWithBlock {
    expr: RhoExpr;
    block: LightBlockInfo;
}

export interface DataAtNameResponse {
    exprs: RhoExprWithBlock[];
    length: number;
}

export interface RhoDataResponse {
    expr: RhoExpr[];
    block: LightBlockInfo;
}

// A JSON value produced by rhoExprToJson (recursive, no `any`).
export type RhoJsonValue =
    | string
    | number
    | boolean
    | null
    | RhoJsonValue[]
    | { [key: string]: RhoJsonValue };

// Domain results returned by the src/utils/rnode.ts seam (consumed by the UI).
export type BalanceResult = { balance: number | null; error: string | null };
export type DeployResult = { deployId: string | null; expr: RhoExpr[] | null; error: string | null };
export type TransferResult = { deployId: string | null; error: string | null };
export type ExploreResult = { expr: RhoExpr[] | null; error: string | null };
export type ProposeResult = { expr: string | null; error: string | null };
export type FaucetResult = { deployId: string };

// --- Shards (`GET /api/v1/shards`) ---

export interface ShardInfo {
    shardId: string;
    primary: boolean;
    latestBlockNumber: number;
}

export interface ShardsResponse {
    primaryShard: string;
    shardCount: number;
    shards: ShardInfo[];
}

// --- Cross-shard transactions (`/api/v1/txn`; gateway + `--enable-txn-api` only) ---

export type TxnState = "proposed" | "prepared" | "committed" | "aborted";

export interface TxnLeg {
    shardId: string;
    // Amount in drops.
    amount: number;
    to: string;
}

export interface TxnVote {
    shardId: string;
    vote: string;
}

// One leg of a transaction: which shard escrows, how much REV, and where a commit credits it.
export interface TxnRequest {
    // Caller-supplied hex (non-empty, ≤ 64 bytes). A retried request must reuse the same id.
    txnId: string;
    legs: TxnLeg[];
}

// The coordinator's durable record, as reported by POST/GET /api/v1/txn.
export interface TxnRecord {
    txnId: string;
    state: string;
    // The coordinator key the participants gate commit/abort on (base16).
    coordinator: string;
    // The record's content address (base16).
    recordHash: string;
    legs: TxnLeg[];
    votes: TxnVote[];
    reason: string | null;
}

export interface TxnListResponse {
    inFlight: TxnRecord[];
}

// --- Proof of Stake (`GET /api/v1/pos`) ---
//
// The node's PoS read surface (`node/src/web/pos_read.rs`, AUDIT C148). `Validator` values are
// lowercase hex of the 65-byte uncompressed secp256k1 key — the same shape as `NamedWallet.pubKey`.
// The endpoint 404s on a node that predates it, so `getPosStatus` returns null rather than throwing.

/** A withdrawal staged and waiting for its epoch boundary + quarantine (`pendingWithdrawers`). */
export interface PendingWithdrawal {
    validator: string;
    stagedAtBlock: number;
    /** Blocks still to be produced before the boundary pays it out; never negative. */
    blocksRemaining: number;
}

export interface PosStatus {
    latestBlockNumber: number;
    /** `epochLength`; `<= 1` means every block is a boundary. */
    epochLength: number;
    /** Distance between a staged withdrawal and its payout. */
    quarantineLength: number;
    /** The number of boundaries behind the head; 0 while every block is a boundary. */
    epoch: number;
    /** Blocks to the next boundary; 0 exactly when the head is one. */
    blocksUntilEpochBoundary: number;
    activeValidators: string[];
    pendingWithdrawals: PendingWithdrawal[];
}

/** The active account's PoS position, read via the `rho:rchain:pos` native methods. */
export type PosInfoResult = {
    /** This account's bond, or null when it is bonded to nothing. */
    bonded: number | null;
    /** Whether this account's key is in the trusted stakeholder set (may therefore bond). */
    trusted: boolean;
    error: string | null;
};

// --- Delegated stake (`GET /api/v1/pos/delegations?delegator=<hex>`) ---
//
// One delegator's positions, across every operator it has staked with (law 57, #193). Scoped to the
// delegator because the ledger is unbounded in delegator count; the operator-scoped listing is not
// offered by the node. The route is mounted unconditionally, so an older node 404s.

/** An undelegation that has been requested and not yet acted on. */
export interface PendingUndelegation {
    /** The block the boundary may act on it at (the staged deadline, quarantine included). */
    deadline: number;
    /** Blocks to that deadline, floored at zero. */
    blocksRemaining: number;
}

/** One operator a delegator has staked with. */
export interface DelegatorPosition {
    /** The operator's 65-byte public key, lowercase hex. */
    operator: string;
    /** The principal delegated to this operator and still attributed to the delegator. */
    amount: number;
    /** Reward accrued to this delegation and not yet paid. */
    accruedRewards: number;
    /** The staged exit, if one is in flight; null when nothing is staged. */
    pendingUndelegation: PendingUndelegation | null;
}
