# AGENTS.md

Entrypoint for AI agents working in this repo. Deep detail lives in
[`docs/DEVELOPER.md`](docs/DEVELOPER.md).

## What this is

`r-wallet` ("R Wallet", ticker **REV**) is a browser SPA that is both a REV
wallet and a **WYSIWYG rholang deployer**. It talks directly to a Rust RNode's
HTTP API — no gRPC, no backend.

Stack: React 18 + TypeScript + Vite + Tailwind + Monaco + react-router.

## Commands

```bash
npm install
npm start            # Vite dev server (http://localhost:5173)
npm run build        # tsc && vite build (type-check + bundle)
npm run test:unit    # tsx scripts/test-unit.ts — pure unit tests (no devnet)
npm run test:rho-json # tsx scripts/test-rho-json.ts — JSON conversion
npm run test:api     # tsx scripts/test-api.ts — integration test vs a running devnet
npm run serve        # vite preview
```

The local devnet lives in **`~/RNodeRust`** (a separate repo, worked on by
another agent):

```bash
cd ~/RNodeRust && tools/devnet.sh build && tools/devnet.sh up --validators 1
# public HTTP 40403, admin HTTP 40405
```

## Architecture (one glance)

```
UI (src/modules, src/components)
  └─ globals.ts          context wrappers (node URL + active user)
       ├─ rnode.ts       seam: check_balance / transfer / deploy / explore / propose
       └─ faucet.ts      POST /api/faucet + poll deploy-status
            └─ client.ts typed HTTP, one function per endpoint
                 └─ http.ts  low-level fetch ({ ok, status, text, json })
```

Supporting modules: `src/api/types.ts` (single source of truth for wire DTOs +
domain results), `src/api/sign.ts` (secp256k1 deploy signing), `src/api/rho-json.ts`
(`RhoExpr` → JSON), `src/utils/rho.ts` (rholang templates), `src/utils/blockchain.ts`
(key/address derivation), `src/utils/networks.ts` (nodes), `src/config/branding.ts`
(`BRAND`).

Routes: `/` editor, `/access` landing, `/balance`, `/transfer`, `/settings`.

## API contract (summary)

One convention in `client.ts`: `httpFetch(METHOD, path, body?) → ensureOk → typed DTO`.

| function | endpoint |
|---|---|
| `getStatus` | `GET /api/status` |
| `exploreDeploy` | `POST /api/explore-deploy` (body = `JSON.stringify(term)`) |
| `deploy` | `POST /api/deploy` |
| `deployStatus` | `GET /api/v1/deploy-status/:id` |
| `propose` | `POST /api/propose` (admin, no body) |
| `dataAtName` | `POST /api/data-at-name` |
| `getBlock` | `GET /api/block/:hash` |
| `faucetRequest` | `POST /api/faucet` |
| `getCapabilities` | `GET /api/v1/capabilities` |
| `getPooledDeploys` | `GET /api/v1/deploys` |

Wire facts: serde enums are **externally tagged** (`{"ExprInt":42}`,
`{"UnforgDeploy":"<hex>"}`); `deploy`/`propose` return **JSON-encoded strings**;
`DeployExecStatus` is `{ProcessedWithSuccess|ProcessedWithError|NotProcessed}`.

## Rules / gotchas (non-negotiable)

1. **`shardId` in the signature** — `src/api/sign.ts` must write `DeployData`
   protobuf field **11** (`shardId`), else every deploy is rejected with
   `"Deploy signature is invalid."`.
2. **Native `revVault`, not Scala** — the node's `rho:rchain:revVault` only has
   `getBalance` / `transfer` (derives `from` from `*deployerId`) / `findOrCreate`.
   Do **not** reintroduce Scala-era `findOrCreate(addr)` / `balance` /
   `deployerAuthKey` rholang. `src/utils/rho.ts` is already correct.
3. **No `any`** in the API-touching path (`client.ts`, `rnode.ts`, `rho-json.ts`,
   `faucet.ts`). Add DTOs/`*Result` types to `src/api/types.ts`.
4. **No deployer private key in the wallet** — the devnet faucet signs server-side;
   the wallet discovers the faucet and gating from `GET /api/v1/capabilities`, not
   hardcoded flags.
5. **Node-ESM interop** — `blakejs`/`elliptic` are CJS with undetectable named
   exports, so import them as **defaults**; `blockchain.ts`'s `module_proxy`
   falls back to `.default`. Preserve this for anything the `tsx` test imports.
6. **Branding** — use `BRAND.name` / `BRAND.ticker` from `src/config/branding.ts`;
   don't hardcode "R Wallet"/"REV"/"GOR".
7. **`vendored/`** is the legacy Scala client — only MetaMask eth-detection still
   touches it. Don't add new imports from it.
8. **Snippet metadata** — template help text lives in `snippet_meta` (in
   `src/modules/wallet/deploy/snippets.ts`): a `description` per snippet plus
   optional `fieldHelp`/`defaults`. The editor's EXPLAIN modal renders them. Add
   a `description` for any new snippet; don't hardcode help strings in `Deploy.tsx`.
9. **Deploy model** — three operations: **explore** (read-only), **deploy**
   (`POST /api/deploy`, always available), and **propose** (admin `POST /api/propose`,
   gated by `capabilities.adminHttp`, fetched from `GET /api/v1/capabilities`).
   Deploys/transfers/faucets are **submit-and-track** (`src/utils/transactions.ts`:
   add a `pending` record, then `refresh_tx_states` polls `deploy-status` AND
   reconciles with `GET /api/v1/deploys`). Authoritative contract: `rchain-rust`
   `docs/src/developer/building-apps.md`.
10. **Help** — a global **help mode** (LayoutContext) reveals inline hints;
    helper modals (`SnippetExplainModal`, `DeployHelpModal`) explain a snippet or
    the deploy operations. Keep explanation copy in the modal/hint, not inline.

## Known node-side issues (out of scope here, in `~/RNodeRust`)

- `explore-deploy` OpenAPI doc-vs-handler discrepancy (`explore-deploy` body is a raw
  string, not `ExploreDeployRequest`).

## When you change the API layer

Update `docs/DEVELOPER.md` and the endpoint table here, and re-run
`npm run build && npm run test:api`.
