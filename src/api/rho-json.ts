// Convert an externally-tagged `RhoExpr` (Rust serde shape) to plain JSON,
// replacing the vendored `rho-json.ts` (which expected the Scala `{Type:{data}}`
// shape).
//
// Two wire forms are accepted, because the node has sent both: this port's (and the reference
// node's) `{"ExprInt":{"data":42}}` — the variant payload is a field-struct named `data` — and the
// bare `{"ExprInt":42}` an early revision of the port emitted. Which one arrives is not the
// editor's business, so every payload goes through `unwrap_payload`; see `src/api/types.ts` for the
// measured evidence and `scripts/test-output-json.ts` for the assertion that the node still
// envelopes.

import type { RhoExpr, RhoJsonValue, RhoMapPayload, RhoPayload } from "./types";

/**
 * `{data: T}` -> `T`, and bare `T` unchanged. An array is never treated as an envelope (its keys are
 * indices), which is what lets the legacy pair-array dictionary pass through untouched.
 */
export function unwrap_payload<T>(v: RhoPayload<T>): T {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && "data" in v) {
        return (v as { data: T }).data;
    }
    return v as T;
}

/**
 * `T` -> `{data: T}`, the inverse of `unwrap_payload`, for the **request** side. The node's request
 * DTOs are the same field-struct shape as its responses, so a bare payload is rejected: measured
 * against a devnet at the node tip, `POST /api/data-at-name` with `{"UnforgDeploy":"<hex>"}` answers
 * `Failed to deserialize the JSON body … name.UnforgDeploy: invalid type: string, expected struct
 * Data`. An already-enveloped value passes through unchanged, so a caller may hand over either form.
 */
export function envelope_payload<T>(v: RhoPayload<T>): { data: T } {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && "data" in v) {
        return v as { data: T };
    }
    return { data: v as T };
}

export function rhoExprToJson(expr: RhoExpr | null | undefined): RhoJsonValue {
    if (expr == null) return null;

    if ("ExprInt" in expr) return unwrap_payload(expr.ExprInt);
    if ("ExprBool" in expr) return unwrap_payload(expr.ExprBool);
    if ("ExprString" in expr) return unwrap_payload(expr.ExprString);
    if ("ExprUri" in expr) return unwrap_payload(expr.ExprUri);
    if ("ExprBytes" in expr) return unwrap_payload(expr.ExprBytes);

    if ("ExprUnforg" in expr) {
        const u = unwrap_payload(expr.ExprUnforg);
        if ("UnforgDeploy" in u) return unwrap_payload(u.UnforgDeploy);
        if ("UnforgDeployer" in u) return unwrap_payload(u.UnforgDeployer);
        if ("UnforgPrivate" in u) return unwrap_payload(u.UnforgPrivate);
        return u;
    }

    if ("ExprList" in expr) return unwrap_payload(expr.ExprList).map(rhoExprToJson);
    if ("ExprTuple" in expr) return unwrap_payload(expr.ExprTuple).map(rhoExprToJson);
    if ("ExprSet" in expr) return unwrap_payload(expr.ExprSet).map(rhoExprToJson);
    if ("ExprPar" in expr) return unwrap_payload(expr.ExprPar).map(rhoExprToJson);

    if ("ExprMap" in expr) {
        // Either a JSON object (this port and the reference node) or the early port's pair array.
        // Both become a JSON object here. Note JS reorders integer-like keys ahead of the rest, so a
        // dictionary keyed "2"/"10" prints in numeric rather than the node's lexicographic order —
        // a display-order difference only, since the values are unchanged.
        const raw = expr.ExprMap as RhoMapPayload;
        const payload: Record<string, RhoExpr> | [string, RhoExpr][] =
            Array.isArray(raw) ? raw : unwrap_payload(raw as RhoPayload<Record<string, RhoExpr>>);

        const obj: Record<string, RhoJsonValue> = {};
        if (Array.isArray(payload)) {
            for (const [k, v] of payload) obj[k] = rhoExprToJson(v);
        } else {
            for (const [k, v] of Object.entries(payload)) obj[k] = rhoExprToJson(v);
        }
        return obj;
    }

    return expr;
}

// Pretty-print a converted result for the editor's response window
// (2-space indent, always valid JSON).
export function formatRhoJson(value: unknown): string {
    return JSON.stringify(value, null, 2) ?? "null";
}

// Format a deploy/explore result (a list of RhoExpr) into the pretty JSON shown
// in the editor's "Output" window. Returns null when there is no result.
export function formatRhoResult(exprs: RhoExpr[] | null | undefined): string | null {
    return exprs ? formatRhoJson(exprs.map(rhoExprToJson)) : null;
}

// What the editor's "Output" window displays, given the operation's error and its
// formatted result: an error wins over a result, and neither means an empty pane.
// Extracted from Deploy.tsx's `show_output()` so the precedence — which is what turned
// a deploy status problem into "no JSON shown" — is pinned by a test rather than
// depending on a browser.
export function output_text(
    err: string | null | undefined,
    msg: string | null | undefined
): string {
    if (err) return err;
    if (msg) return msg;
    return "";
}
