# r-wallet Developer Guide

`r-wallet` ("R Wallet") is a browser SPA that is both a **REV wallet** and a
**WYSIWYG rholang deployer**. It talks directly to a Rust RNode's HTTP API — no
gRPC, no intermediate backend.

- Stack: React 18, TypeScript 5, Vite 5, Tailwind 3, Monaco (`@monaco-editor/react`), react-router 6.
- Runtime targets: the node's **public HTTP API** (in-container `40403`) and **admin HTTP API** (`40405`).

---

## Architecture

The API-touching code is layered so each level has one job:

```
UI (src/modules, src/components)
  └─ globals.ts            context-aware wrappers (pass the node URL + user)
       └─ rnode.ts         domain seam: check_balance / transfer / deploy / explore / propose
       └─ faucet.ts        faucet: POST /api/faucet + poll deploy-status
            └─ client.ts   typed HTTP calls, one function per endpoint
                 └─ http.ts  low-level fetch wrapper (returns { ok, status, text, json })
```

Supporting modules:

| Path | Purpose |
|---|---|
| `src/api/types.ts` | **Single source of truth** for wire DTOs + domain result types |
| `src/api/sign.ts` | secp256k1 deploy signing (incl. the `shardId` field-11 fix and RCHIP #39 `attachments` field 12) |
| `src/api/rho-json.ts` | `rhoExprToJson`: externally-tagged `RhoExpr` → plain JSON |
| `src/api/faucet.ts` | devnet faucet (native endpoint + `deploy-status` poll) |
| `src/utils/rho.ts` | rholang templates (`fn_check_balance`, `fn_transfer_funds`) |
| `src/utils/blockchain.ts` | key/address derivation (keystore, mnemonic, private key, MetaMask) |
| `src/utils/networks.ts` | node definitions + URL helpers |
| `src/config/branding.ts` | `BRAND` (name/ticker/subunit) — use this, don't hardcode strings |
| `src/config/playground.ts` | pre-funded testnet accounts + `pick_random_account` for the landing card |
| `src/utils/playground.ts` | `activate_account`: derive a testnet account, set it active, route to `/balance` |

Routes: `/` (editor), `/access` (landing), `/balance`, `/transfer`, `/history`,
`/settings`, plus `/access/*` and `/create/*`. The landing page's **TESTNET WALLET**
card loads a pre-funded testnet account and reveals its address and private key.

---

## Getting started

Prereqs: Node 20+, and Docker if you want to run a local devnet.

```bash
npm install
npm start            # Vite dev server on http://localhost:5173
```

To run against a local node (from `~/rchain-rust`, the
[`rchain-community/rchain-rust`](https://github.com/rchain-community/rchain-rust) repo):

```bash
tools/devnet.sh build
tools/devnet.sh up --validators 1     # public HTTP 40403, admin HTTP 40405
```

Then in the app, select the `localhost-0` node.

---

## The HTTP API contract

All endpoints share one convention in `src/api/client.ts`:

```
httpFetch(METHOD, path, body?)  ->  ensureOk(res)  ->  return typed DTO
```

`base` = public API (default `http://localhost:40403`), `adminBase` = `http://localhost:40405`.

| function | method + path | request body | response |
|---|---|---|---|
| `getStatus(base)` | `GET /api/status` | — | `ApiStatus` |
| `exploreDeploy(base, term)` | `POST /api/explore-deploy` | `JSON.stringify(term)` (raw JSON **string**) | `RhoDataResponse { expr, block }` |
| `deploy(base, signed)` | `POST /api/deploy` | `DeployRequest` | JSON string `"Success!\nDeployId is: <hex>"` → returns hex |
| `deployStatus(base, id)` | `GET /api/v1/deploy-status/:id` | — | `DeployExecStatus` |
| `propose(adminBase)` | `POST /api/propose` | none | JSON string `"Success! Block <hash> …"` |
| `dataAtName(base, name, depth)` | `POST /api/data-at-name` | `{ name: RhoUnforg, depth }` | `DataAtNameResponse { exprs, length }` |
| `getBlock(base, hash)` | `GET /api/block/:hash` | — | `BlockInfo { blockInfo, deploys }` |
| `faucetRequest(base, address)` | `POST /api/faucet` | `{ address }` | `FaucetResponse { deployId, amount, to }` |
| `getCapabilities(base)` | `GET /api/v1/capabilities` | — | `NodeCapabilities { autopropose, proposeOnDeploy, manualPropose, adminHttp, devMode, faucet }` |
| `getPooledDeploys(base)` | `GET /api/v1/deploys` | — | `PooledDeploys { deploys: [PooledDeploy] }` |
| `getShards(base)` | `GET /api/v1/shards` | — | `ShardsResponse { primaryShard, shardCount, shards: [ShardInfo] }` |
| `runTxn(base, req)` | `POST /api/v1/txn` | `{ txnId, legs: [{ shardId, amount, to }] }` | `TxnRecord` (gateway only; 404 otherwise) |
| `getTxn(base, id)` | `GET /api/v1/txn/:txnId` | — | `TxnRecord`, or `null` on 404 |
| `getTxnList(base)` | `GET /api/v1/txn` | — | `TxnListResponse { inFlight: [TxnRecord] }` |

`ApiStatus` also carries the same capability flags (`autopropose`,
`proposeOnDeploy`, `manualPropose`, `adminHttp`, `devMode`) as `/api/v1/capabilities`.

### Wire facts (don't deviate)

- Serde enums are **externally tagged**: `ExprInt(42)` → `{"ExprInt":42}`,
  `UnforgDeploy(x)` → `{"UnforgDeploy":"<hex>"}` (no `{data}` wrapper).
- `deploy` / `propose` return a **JSON-encoded string** (axum `Json<String>`),
  so read `res.json` (a string), not `res.text`.
- `DeployExecStatus` is externally tagged:
  `{ProcessedWithSuccess:{deployResult,block}}`,
  `{ProcessedWithError:{deployError,block}}`, `{NotProcessed:{status}}`.
- `LightBlockInfo` / `DeployInfo` / `PooledDeploy` field names are the node's
  camelCase DTOs; `LightBlockInfo` (incl. `timestamp`) is always fully populated.

### Deploy signing

`src/api/sign.ts` serializes `DeployData` to protobuf and signs with
`blake2b256(serialized)` + secp256k1 DER (low-S):

| field | proto tag |
|---|---|
| term | 2 |
| timestamp | 3 |
| phloPrice | 7 |
| phloLimit | 8 |
| validAfterBlockNumber | 10 |
| **shardId** | **11** |
| **attachments** (repeated bytes, hex in JSON) | **12** |

`shardId` **must** be written (field 11) or the node rejects the deploy with
`"Deploy signature is invalid."`. Its **value** must be the node's full shard id
(`/root` for the default shard), so `src/utils/rnode.ts` reads it from
`/api/status` instead of hardcoding it — a mismatch is rejected with
`"Deploy shardId '…' is not as expected network shard '…'."`.

**Attachments (RCHIP #39)** are hex strings (strict `base16`: even length, no
`0x`), signed as field 12. Each is readable in the deploy as
`` `rho:attachment:1` ``, `` `rho:attachment:2` ``, … in order (a `ByteArray`). An
empty list is omitted entirely, so a pre-#39 deploy encodes byte-identically.

---

## Rholang: the native `revVault` API

The Rust node exposes a **native** `rho:rchain:revVault` system process
(`rholang/src/system_processes.rs`), which differs from the old Scala API:

| method | args | notes |
|---|---|---|
| `getBalance` | `[addr_string, ret]` | produces the balance (Int); `0` if absent |
| `transfer` | `[*deployerId, to_string, amount, ret]` | `from` is derived from the caller's `deployerId`; self-transfer is a no-op |
| `findOrCreate` | `[*deployerId, ret]` | produces `(true, addr)` |

The wallet's templates in `src/utils/rho.ts` use these:

- `fn_check_balance(addr)` → `revVault!("getBalance", addr, *balanceCh)`.
- `fn_transfer_funds(to, amount)` → `revVault!("transfer", *deployerId, to, amount, *resultCh)`
  (no `from` — the signer's `deployerId` is the source).

---

## Deploy & transactions

The three operations an app performs against a node (per
[`rchain-rust` `docs/src/developer/building-apps.md`](https://github.com/rchain-community/rchain-rust/blob/main/docs/src/developer/building-apps.md)):

1. **Explore** — `POST /api/explore-deploy` (read-only eval); the result goes to the editor's response window.
2. **Deploy** — sign `DeployData` and `POST /api/deploy`; the deploy lands in the pool and is included when the node proposes. Always available.
3. **Propose** — `POST /api/propose` (admin `40405`) forces a block. **Gated by `capabilities.adminHttp`** (fetched from `GET /api/v1/capabilities`); hidden elsewhere.

Deploys/transfers/faucets are **submit-and-track**: `src/utils/transactions.ts` records each
submission (`pending`), and the Transactions list on the Dashboard polls `deploy-status` to move it
to `finalized`/`failed`. Each refresh also reconciles with the node's `GET /api/v1/deploys` (pooled
deploys), so pending deploys are re-discovered across sessions/devices.

---

## Testing

```bash
npm run test:unit       # pure unit tests — no devnet required
npm run test:rho-json   # rhoExprToJson + formatRhoJson (incl. the Output-window formatter)
npm run test:deploy     # deploy result-shapes + Output-window JSON (devnet)
npm run test:api        # integration test against a running devnet
npm run test:output     # Output-window JSON for every editor snippet, against goldens
```

**`test:output`** sweeps every snippet in `snippets.ts`, builds the term the editor would build, runs
it through `src/utils/rnode.ts`, and compares what the Output pane would show
(`output_text(err, formatRhoResult(expr))`) with a committed golden in
`scripts/goldens/output/<host>/<snippet>.txt`. A snippet missing from its `CASES` table fails the
run, so a new snippet cannot silently escape coverage.

- `-- --node <url>` targets another node (`RNODE_URL` also works); default `http://localhost:40403`.
- `-- --record` rewrites the goldens for that host; the default run only compares.
- Contracts that read `rho:rchain:deployId` / `rho:rchain:deployerId` are run through the deploy
  path automatically: `explore-deploy` does not bind those channels, so exploring them fails with
  `No value set for \`rho:rchain:deployId\`` — an artefact of explore, not of the contract.
- Run-dependent output is normalised before recording *and* comparing: REV addresses → `<ADDR>`,
  registered `rho:id`s → `<RHO-ID>`, deploy signatures/block hashes → `<HEX>`, a free-variable dump
  tail → `<elided>`, and the top-level result is sorted (a result is an unordered Par, so its order
  varies between runs).
- A case whose result is chain state that moves under the run's own feet — a REV balance that falls
  with every deploy's gas, a kudos counter that climbs once per run — declares
  `volatile_numbers: "<why>"`, and every number leaf of its pane is then written as `<INT>`. The
  golden still pins the shape, the keys and that a value is present, but not the drifting number, so
  it is deliberately not valid JSON. Such a case passes only if two consecutive compare runs pass:
  one clean run is not evidence that the value has stopped drifting.

**Unit tests** (`scripts/test-unit.ts`) import the real modules and cover, without a
devnet: deploy signing (`signDeploy` + the `shardId` field-11 serialization + RCHIP #39
`attachments` field-12 serialization, including the tamper/changed-signature check), REV
address derivation, the native `revVault` rholang templates, snippet generation +
`snippet_meta` completeness, `client` response parsing (stubbed `fetch`, incl. shards and
the tx DTOs), and `transactions` `add_tx`/pooled-deploys reconciliation.

**Integration test** (`scripts/test-api.ts`) asserts every `client.*` endpoint's shape and,
end-to-end against the devnet, exercises `check_balance`, `deploy` (+ `deploy-status` and a
binary-attachment round-trip), `transfer`, `propose`, `faucet`, the `rnode` seam,
capabilities, pooled deploys, shards, the tx list, and transaction reconciliation.

All tests run under Node via `tsx` (not Vite), so the API modules must be Node-ESM
compatible (see the interop note below).

`npm run build` runs `tsc && vite build` (type-check + bundle).

---

## Gotchas

- **CORS**: the admin API (`propose`) only sends permissive CORS under
  `--api-enable-devnet-cors`. The devnet sets this; a custom node may not.
- **Node ESM / CJS interop**: `blakejs` and `elliptic` use
  `module.exports = { … }` with values Node's ESM loader can't statically detect,
  so they're imported as **defaults** (`import blake from "blakejs"`,
  `import elliptic from "elliptic"`), and `blockchain.ts`'s `module_proxy` falls
  back to `.default`. Keep this pattern if you add CJS deps used by the test.
- **`vendored/`** holds the old Scala-era `@tgrospic/rnode-http-js` client. It is
  no longer used for deploy/transfer/explore; only MetaMask eth-detection still
  reaches into it (`src/utils/blockchain.ts`).
- **Don't put the deployer key in the wallet** — the devnet faucet signs
  server-side; the wallet discovers the faucet (and gating) from the node's
  `GET /api/v1/capabilities`, not from hardcoded flags.

---

## Conventions

- One typed function per endpoint in `src/api/client.ts`; add DTOs to
  `src/api/types.ts` (wire types) and reuse the `*Result` domain types.
- No `any` in the API-touching path.
- Branding strings come from `src/config/branding.ts` (`BRAND.name` / `BRAND.ticker`).
- Contract-template help lives in `snippet_meta` (in
  `src/modules/wallet/deploy/snippets.ts`): a `description` per snippet, plus
  optional `fieldHelp`/`defaults`. The editor's EXPLAIN modal renders these;
  don't hardcode help strings in `Deploy.tsx`.
- A global **help mode** (toggled from the Navigation) reveals inline hints;
  one-off helper modals (`SnippetExplainModal`, `DeployHelpModal`) explain a
  snippet or the deploy operations. Keep explanation text in the modal/hint,
  not scattered in the UI.
