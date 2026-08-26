// Unit test for rhoExprToJson + formatRhoJson (the editor response-window
// formatting). Pure/deterministic — no devnet required.
// Run with: npm run test:rho-json

import { rhoExprToJson, formatRhoJson } from "../src/api/rho-json";
import type { RhoExpr } from "../src/api/types";

let failures = 0;
function check(cond: boolean, label: string) {
    if (cond) console.log(`  PASS  ${label}`);
    else {
        console.error(`  FAIL  ${label}`);
        failures++;
    }
}

function eq(actual: unknown, expected: unknown, label: string) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    check(a === e, `${label}  (got ${a}, want ${e})`);
}

// Terminal variants
eq(rhoExprToJson({ ExprInt: 42 }), 42, "ExprInt -> 42");
eq(rhoExprToJson({ ExprInt: -7 }), -7, "ExprInt -> -7");
eq(rhoExprToJson({ ExprBool: true }), true, "ExprBool -> true");
eq(rhoExprToJson({ ExprString: "hello" }), "hello", "ExprString -> hello");
eq(rhoExprToJson({ ExprUri: "rho:id:x" }), "rho:id:x", "ExprUri -> string");
eq(rhoExprToJson({ ExprBytes: "deadbeef" }), "deadbeef", "ExprBytes -> hex string");

// Unforgeable names collapse to their hex payload
eq(rhoExprToJson({ ExprUnforg: { UnforgDeploy: "abcd" } }), "abcd", "UnforgDeploy -> hex");
eq(rhoExprToJson({ ExprUnforg: { UnforgDeployer: "beef" } }), "beef", "UnforgDeployer -> hex");
eq(rhoExprToJson({ ExprUnforg: { UnforgPrivate: "cafe" } }), "cafe", "UnforgPrivate -> hex");

// Collections
eq(rhoExprToJson({ ExprList: [{ ExprInt: 1 }, { ExprInt: 2 }] }), [1, 2], "ExprList -> array");
eq(rhoExprToJson({ ExprTuple: [{ ExprInt: 1 }, { ExprBool: false }] }), [1, false], "ExprTuple -> array");
eq(rhoExprToJson({ ExprSet: [{ ExprInt: 1 }] }), [1], "ExprSet -> array");
eq(rhoExprToJson({ ExprPar: [{ ExprInt: 1 }, { ExprString: "a" }] }), [1, "a"], "ExprPar -> array");
eq(rhoExprToJson({ ExprMap: [["k", { ExprInt: 1 }]] }), { k: 1 }, "ExprMap -> object");

// Nested
const nested: RhoExpr = {
    ExprTuple: [
        { ExprBool: true },
        { ExprString: "ok" },
        { ExprMap: [["x", { ExprInt: 1 }]] },
    ],
};
eq(rhoExprToJson(nested), [true, "ok", { x: 1 }], "nested tuple/map");

// null / undefined
check(rhoExprToJson(null) === null, "null -> null");
check(rhoExprToJson(undefined) === null, "undefined -> null");

// Formatting: pretty-print, 2-space indent, valid JSON
const pretty = formatRhoJson(rhoExprToJson(nested));
check(pretty === '[\n  true,\n  "ok",\n  {\n    "x": 1\n  }\n]', "tuple pretty-prints with 2-space indent");
check(JSON.parse(pretty).length === 3, "formatted output is valid JSON");
check(formatRhoJson(rhoExprToJson({ ExprInt: 42 })) === "42", "scalar pretty-prints as the bare value");
check(formatRhoJson(null) === "null", "null -> \"null\"");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
