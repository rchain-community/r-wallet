// Low-level HTTP helper. Unlike the vendored client, it does NOT blindly
// `resp.json()` — `deploy`/`propose` return JSON-encoded strings, but other
// endpoints may return an empty body or a plain error string.

export interface RNodeHttpResult {
    ok: boolean;
    status: number;
    text: string;
    json?: unknown;
}

export async function httpFetch(
    method: "GET" | "POST",
    url: string,
    body?: string
): Promise<RNodeHttpResult> {
    const opt: RequestInit = { method };
    if (body !== undefined) {
        opt.body = body;
        opt.headers = { "Content-Type": "application/json" };
    }

    const resp = await fetch(url, opt);
    const text = await resp.text();

    let json: unknown;
    try {
        json = text ? JSON.parse(text) : undefined;
    } catch {
        json = undefined;
    }

    return { ok: resp.ok, status: resp.status, text, json };
}
