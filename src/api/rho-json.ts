// Convert an externally-tagged `RhoExpr` (Rust serde shape) to plain JSON,
// replacing the vendored `rho-json.ts` (which expected the Scala `{Type:{data}}`
// shape).

import type { RhoExpr, RhoJsonValue } from "./types";

export function rhoExprToJson(expr: RhoExpr | null | undefined): RhoJsonValue {
    if (expr == null) return null;

    if ("ExprInt" in expr) return expr.ExprInt;
    if ("ExprBool" in expr) return expr.ExprBool;
    if ("ExprString" in expr) return expr.ExprString;
    if ("ExprUri" in expr) return expr.ExprUri;
    if ("ExprBytes" in expr) return expr.ExprBytes;

    if ("ExprUnforg" in expr) {
        const u = expr.ExprUnforg;
        if ("UnforgDeploy" in u) return u.UnforgDeploy;
        if ("UnforgDeployer" in u) return u.UnforgDeployer;
        if ("UnforgPrivate" in u) return u.UnforgPrivate;
        return u;
    }

    if ("ExprList" in expr) return expr.ExprList.map(rhoExprToJson);
    if ("ExprTuple" in expr) return expr.ExprTuple.map(rhoExprToJson);
    if ("ExprSet" in expr) return expr.ExprSet.map(rhoExprToJson);
    if ("ExprPar" in expr) return expr.ExprPar.map(rhoExprToJson);

    if ("ExprMap" in expr) {
        const obj: Record<string, RhoJsonValue> = {};
        for (const [k, v] of expr.ExprMap) obj[k] = rhoExprToJson(v);
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
