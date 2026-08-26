// Typed functions for the RNode (Rust) HTTP API — deployer-only subset.
// One function per endpoint, all following the same convention:
//   httpFetch(METHOD, path, body?) -> ensureOk(res) -> return the typed DTO.

import { httpFetch } from "./http";
import type {
    ApiStatus,
    BlockInfo,
    DataAtNameResponse,
    DeployExecStatus,
    DeployRequest,
    RhoDataResponse,
    RhoUnforg,
} from "./types";

const api = (base: string, path: string) => `${base.replace(/\/$/, "")}/api/${path}`;

function ensureOk(res: { ok: boolean; status: number; text: string }) {
    if (!res.ok) {
        throw new Error(res.text || `HTTP ${res.status}`);
    }
}

export async function getStatus(url: string): Promise<ApiStatus> {
    const res = await httpFetch("GET", api(url, "status"));
    ensureOk(res);
    return res.json as ApiStatus;
}

export async function exploreDeploy(url: string, term: string): Promise<RhoDataResponse> {
    // Body is a raw JSON string (the rholang term), not a JSON object.
    const res = await httpFetch("POST", api(url, "explore-deploy"), JSON.stringify(term));
    ensureOk(res);
    return res.json as RhoDataResponse;
}

export async function deploy(url: string, signed: DeployRequest): Promise<string> {
    const res = await httpFetch("POST", api(url, "deploy"), JSON.stringify(signed));
    ensureOk(res);
    // Success body is a JSON-encoded string: "Success!\nDeployId is: <hex>".
    const result: string = typeof res.json === "string" ? res.json : res.text;
    const m = result.match(/DeployId is: ([0-9a-fA-F]+)/);
    if (!m) throw new Error(result || "Deploy did not return a deploy id.");
    return m[1];
}

export async function deployStatus(url: string, deployId: string): Promise<DeployExecStatus> {
    const res = await httpFetch("GET", api(url, `v1/deploy-status/${deployId}`));
    ensureOk(res);
    return res.json as DeployExecStatus;
}

export async function propose(adminUrl: string): Promise<string> {
    // No body — the admin propose handler takes no JSON payload.
    const res = await httpFetch("POST", `${adminUrl.replace(/\/$/, "")}/api/propose`);
    ensureOk(res);
    return typeof res.json === "string" ? res.json : res.text;
}

export async function dataAtName(url: string, name: RhoUnforg, depth = 1): Promise<DataAtNameResponse> {
    const body = JSON.stringify({ name, depth });
    const res = await httpFetch("POST", api(url, "data-at-name"), body);
    ensureOk(res);
    return res.json as DataAtNameResponse;
}

export async function getBlock(url: string, hash: string): Promise<BlockInfo> {
    const res = await httpFetch("GET", api(url, `block/${hash}`));
    ensureOk(res);
    return res.json as BlockInfo;
}
