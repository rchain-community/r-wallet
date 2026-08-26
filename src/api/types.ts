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
}

export interface BondInfo {
    validator: string;
    stake: number;
}

export interface LightBlockInfo {
    version?: number;
    shardId?: string;
    blockHash: string;
    blockNumber: number;
    sender: string;
    seqNum: number;
    preStateHash?: string;
    postStateHash?: string;
    justifications?: string[];
    bonds?: BondInfo[];
    sigAlgorithm?: string;
    sig?: string;
    blockSize?: string;
    deployCount?: number;
    rejectedDeploys?: string[];
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
export type DeployResult = { message: string | null; cost: number | null; error: string | null };
export type TransferResult = { cost: number | null; error: string | null };
export type ExploreResult = { expr: RhoExpr[] | null; error: string | null };
export type ProposeResult = { expr: string | null; error: string | null };
export type FaucetResult = { deployId: string };
