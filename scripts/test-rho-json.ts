// Unit test for rhoExprToJson + formatRhoJson (the editor response-window
// formatting). Pure/deterministic — no devnet required.
// Run with: npm run test:rho-json

import { rhoExprToJson, formatRhoJson, formatRhoResult, output_text } from "../src/api/rho-json";
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

// --- The wire form a node actually sends (and the reference Scala node sends): every variant
// payload is a field-struct, `{"data": …}`. Measured from a live node:
//   explore-deploy "42"             -> [{"ExprInt":{"data":42}}]
//   explore-deploy "{\"a\":\"b\"}"  -> [{"ExprMap":{"data":{"a":{"ExprString":{"data":"b"}}}}}]
// These are the cases that were failing in the editor: the parser returned the envelope itself for
// scalars (so the pane showed `{"data":999992610000}`) and threw for collections.
eq(rhoExprToJson({ ExprInt: { data: 42 } }), 42, "enveloped ExprInt -> 42");
eq(rhoExprToJson({ ExprBool: { data: false } }), false, "enveloped ExprBool -> false");
eq(rhoExprToJson({ ExprString: { data: "hi" } }), "hi", "enveloped ExprString -> hi");
eq(rhoExprToJson({ ExprUri: { data: "rho:id:x" } }), "rho:id:x", "enveloped ExprUri -> string");
eq(rhoExprToJson({ ExprBytes: { data: "deadbeef" } }), "deadbeef", "enveloped ExprBytes -> hex");
eq(
    rhoExprToJson({ ExprUnforg: { data: { UnforgDeploy: { data: "abcd" } } } }),
    "abcd",
    "enveloped ExprUnforg/UnforgDeploy -> hex"
);
eq(
    rhoExprToJson({ ExprList: { data: [{ ExprInt: { data: 1 } }, { ExprInt: { data: 2 } }] } }),
    [1, 2],
    "enveloped ExprList -> array"
);
eq(
    rhoExprToJson({ ExprTuple: { data: [{ ExprInt: { data: 1 } }, { ExprBool: { data: true } }] } }),
    [1, true],
    "enveloped ExprTuple -> array"
);
eq(rhoExprToJson({ ExprSet: { data: [{ ExprInt: { data: 1 } }] } }), [1], "enveloped ExprSet -> array");
eq(
    rhoExprToJson({ ExprMap: { data: { a: { ExprString: { data: "b" } } } } }),
    { a: "b" },
    "enveloped ExprMap -> object"
);

// The measured reply, verbatim, as a whole response body would carry it.
eq(
    rhoExprToJson({
        ExprMap: { data: { a: { ExprString: { data: "b" } } } },
    } as RhoExpr),
    { a: "b" },
    "recorded node reply: ExprMap envelope -> {a: \"b\"}"
);

// A dictionary as a bare JSON object (no envelope) — the same rule, one less wrapper.
eq(rhoExprToJson({ ExprMap: { a: { ExprInt: 1 } } }), { a: 1 }, "bare-object ExprMap -> object");
eq(
    rhoExprToJson({ ExprMap: { data: { b: { ExprBool: true }, a: { ExprInt: 1 } } } }),
    { b: true, a: 1 },
    "ExprMap keeps the node's key order"
);

// Mixed: the bare form nested inside the enveloped one, which is what a half-updated chain sends.
eq(
    rhoExprToJson({
        ExprList: { data: [{ ExprInt: 1 }, { ExprString: { data: "x" } }, { ExprMap: [["k", { ExprInt: 2 }]] }] },
    }),
    [1, "x", { k: 2 }],
    "bare and enveloped payloads mix within one value"
);

// null / undefined
check(rhoExprToJson(null) === null, "null -> null");
check(rhoExprToJson(undefined) === null, "undefined -> null");

// The editor pane, end to end, for the two replies that were broken.
check(
    formatRhoResult([{ ExprInt: { data: 42 } } as RhoExpr]) === "[\n  42\n]",
    "formatRhoResult([enveloped ExprInt]) -> [42]"
);
check(
    formatRhoResult([{ ExprMap: { data: { a: { ExprString: { data: "b" } } } } } as RhoExpr]) ===
        '[\n  {\n    "a": "b"\n  }\n]',
    "formatRhoResult([enveloped ExprMap]) -> nested JSON, no envelope in the pane"
);

// Formatting: pretty-print, 2-space indent, valid JSON
const pretty = formatRhoJson(rhoExprToJson(nested));
check(pretty === '[\n  true,\n  "ok",\n  {\n    "x": 1\n  }\n]', "tuple pretty-prints with 2-space indent");
check(JSON.parse(pretty).length === 3, "formatted output is valid JSON");
check(formatRhoJson(rhoExprToJson({ ExprInt: 42 })) === "42", "scalar pretty-prints as the bare value");
check(formatRhoJson(null) === "null", "null -> \"null\"");

// formatRhoResult — the exact "Output" window formatting for a deploy/explore result
check(formatRhoResult(null) === null, "formatRhoResult(null) -> null");
check(formatRhoResult(undefined) === null, "formatRhoResult(undefined) -> null");
check(formatRhoResult([]) === "[]", "formatRhoResult([]) -> []");
check(formatRhoResult([{ ExprInt: 42 }]) === "[\n  42\n]", "formatRhoResult([ExprInt 42]) -> [42]");
check(
    formatRhoResult([{ ExprTuple: [{ ExprBool: true }, { ExprString: "done" }] }]) === '[\n  [\n    true,\n    "done"\n  ]\n]',
    "formatRhoResult([tuple]) -> nested JSON"
);

// output_text — what the "Output" window actually displays. An error wins over a result,
// which is the rule that let a deploy-status problem masquerade as "no JSON shown".
const json = formatRhoResult([{ ExprInt: 42 }]);
check(output_text(null, json) === json, "output_text shows the JSON when there is no error");
check(
    output_text("Timed out waiting for deploy result.", json) === "Timed out waiting for deploy result.",
    "output_text prefers the error over the JSON"
);
check(output_text(null, null) === "", "output_text is empty when there is neither error nor result");
check(output_text(null, "") === "", "output_text is empty for an empty result string");
check(output_text("boom", null) === "boom", "output_text shows an error with no result");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
