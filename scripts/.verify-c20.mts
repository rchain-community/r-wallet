import { exploreDeploy } from "../src/api";

// My own minimal reproduction of C20 — deliberately not the agent's test, and run against a real
// node rather than the in-process runtime, since that distinction is the whole lesson here.
const term = `
new result, a, b, c in {
  a!({"x": 1, "y": 2}) |
  b!({"x": 1, "y": 2}) |
  c!({"grant": 0, "read": 0, "write": 0}) |
  for (@{"x": *v, ..._} <- a) { result!(["partial-map-2key", "matched"]) } |
  for (@{"x": *w, "y": *z} <- b) { result!(["exact-map-2key", "matched"]) } |
  for (@{"read": *m, ..._} <<- c) { result!(["rgov-gate-shape-3key", "matched"]) }
}
`;

const res = await exploreDeploy("http://localhost:40403", term);
console.log(JSON.stringify(res.expr, null, 2));
