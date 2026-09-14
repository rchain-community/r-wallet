// Wire types for the RNode (Rust) HTTP API. Serde enums are externally tagged,
// so `RhoExpr::ExprInt(42)` serializes as `{"ExprInt":42}` (no `data` wrapper).

export type RhoUnforg =
    | { UnforgPrivate: string }
    | { UnforgDeploy: string }
    | { UnforgDeployer: string };

export type RhoExpr =
    | { ExprPar: RhoExpr[] }
    | { ExprTuple: RhoExpr[] }
    | { ExprList: RhoExpr[] }
    | { ExprSet: RhoExpr[] }
    | { ExprMap: [string, RhoExpr][] }
    | { ExprBool: boolean }
    | { ExprInt: number }
    | { ExprString: string }
    | { ExprUri: string }
    | { ExprBytes: string }
    | { ExprUnforg: RhoUnforg };

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
