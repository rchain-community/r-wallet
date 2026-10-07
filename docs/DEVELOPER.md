# r-wallet Developer Guide

`r-wallet` ("R Wallet") is a browser SPA that is both a **REV wallet** and a
**WYSIWYG rholang deployer**. It talks directly to a Rust RNode's HTTP API — no
gRPC, no intermediate backend.

- Stack: React 18, TypeScript 5, Vite 6, Tailwind 3, Monaco (`@monaco-editor/react`), react-router 7.
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
| `src/config/playground.ts` | genesis-funded testnet accounts (genesis roll set + bootstrap deployer key) |
| `src/utils/faucet-login.ts` | `login_with_faucet`: generate a wallet, save its keystore, fund it from the faucet |

Routes: `/` (editor), `/access` (landing), `/balance`, `/transfer`, `/staking`,
`/history`, `/settings`, plus `/access/*` and `/create/*`. The landing page's **LOGIN WITH FAUCET**
card generates a fresh testnet wallet, downloads its keystore, and funds it from the selected
node's faucet; a node that serves no faucet shows a notice instead.

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
| `dataAtName(base, name, depth)` | `POST /api/data-at-name` | `{ name: <RhoUnforg, enveloped>, depth }` | `DataAtNameResponse { exprs, length }` |
| `getBlock(base, hash)` | `GET /api/block/:hash` | — | `BlockInfo { blockInfo, deploys }` |
| `getBlocksByHeights(base, start, end)` | `GET /api/blocks/:start/:end` | — | `LightBlockInfo[]` for heights `start..=end`; the node refuses a range wider than `max-blocks-limit` (50 by default) |
| `faucetRequest(base, address)` | `POST /api/faucet` | `{ address }` | `FaucetResponse { deployId, amount, to }` |
| `getCapabilities(base)` | `GET /api/v1/capabilities` | — | `NodeCapabilities { autopropose, proposeOnDeploy, manualPropose, adminHttp, devMode, faucet }` |
| `getPooledDeploys(base)` | `GET /api/v1/deploys` | — | `PooledDeploys { deploys: [PooledDeploy] }` |
| `getShards(base)` | `GET /api/v1/shards` | — | `ShardsResponse { primaryShard, shardCount, shards: [ShardInfo] }` |
| `runTxn(base, req)` | `POST /api/v1/txn` | `{ txnId, legs: [{ shardId, amount, to }] }` | `TxnRecord` (gateway only; 404 otherwise) |
| `getPosStatus(base)` | `GET /api/v1/pos` | — | `PosStatus`, or `null` on 404 (node predates the route) |
| `getDelegations(base, hex)` | `GET /api/v1/pos/delegations?delegator=<hex>` | — | `DelegatorPosition[]`, or `null` on 404; 400 for a malformed key |
| `getTxn(base, id)` | `GET /api/v1/txn/:txnId` | — | `TxnRecord`, or `null` on 404 |
| `getTxnList(base)` | `GET /api/v1/txn` | — | `TxnListResponse { inFlight: [TxnRecord] }` |

`ApiStatus` also carries the same capability flags (`autopropose`,
`proposeOnDeploy`, `manualPropose`, `adminHttp`, `devMode`) as `/api/v1/capabilities`.

### Wire facts (don't deviate)

- Serde enums are **externally tagged**, and each variant's payload is a **field-struct named
  `data`**: `ExprInt(42)` → `{"ExprInt":{"data":42}}`, `UnforgDeploy(x)` →
  `{"UnforgDeploy":{"data":"<hex>"}}`. This is the reference (Scala) node's shape as well —
  `JsonSchemaDerivation` declares `final case class ExprInt(data: Long)` and serializes the field —
  so the envelope is the contract, not a quirk of this port. `src/api/rho-json.ts` reads either form
  (`unwrap_payload`), because an early revision of the port emitted the bare one; an `ExprMap`
  payload is a JSON **object** (keys in canonical sorted order), with the early pair-array form
  still accepted. The **request** side is enveloped too: a bare
  `{"UnforgDeploy":"<hex>"}` is rejected with `expected struct Data`, which `envelope_payload`
  handles.
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
- `fn_sweep(from, to)` → `getBalance(from)` then `transfer` of exactly that balance, in one deploy
  (see *Quantum key hygiene* below).

## Quantum key hygiene

The wallet side of `rchain-rust`'s post-quantum plan
([`docs/src/contributor/post-quantum-plan.md`](https://github.com/rchain-community/rchain-rust/blob/dev/docs/src/contributor/post-quantum-plan.md)
§16.1). A REV address is a hash of the public key, so receiving REV reveals nothing; the key becomes
public the first time it signs a deploy. Value is safest behind a key that has never signed.

- **Is the key revealed?** `src/utils/exposure.ts` `check_exposure(node, pubKey)`. Evidence, in order:
  the wallet's own record (`mark_revealed`, called in `rnode.ts`'s signing path before every deploy is
  sent), the node's pool (`GET /api/v1/deploys`), then a scan of the chain for a deploy whose
  `deployer` is the key. The node has no index by deployer, so the scan pages
  `GET /api/blocks/:start/:end` in chunks of 50 and fetches `GET /api/block/:hash` only for blocks
  with `deployCount > 0`. It is incremental (progress cached per `node|key`, at most 2000 heights per
  check) and a reveal is remembered for good. "Not seen" always carries the range scanned; an
  unreachable node is `unknown`, never "not seen".
- **Warning.** `should_warn` is true only for a revealed key holding more than the threshold
  (default 10 REV, set on the Settings page, stored as `exposure-threshold`).
- **Sweep.** The Dashboard's `KeyExposure` panel generates a fresh account, downloads its keystore
  *first*, then signs `rho.fn_sweep` with the old key (`rnode.sweep`), and on success makes the fresh
  account active. The balance is read inside the deploy, after phlo is pre-charged, so the amount is
  exact. The unused phlo is refunded to the *old* address afterwards: dust of at most
  `SWEEP_PHLO_LIMIT × phloPrice` (20,000 drops at price 1; a sweep measured about 3,000 phlo) stays
  behind, which a single deploy cannot avoid. `scripts/probe-sweep.mts` runs the whole flow against
  a node.
- **Not here yet:** one-time-key management for `PQVault` (§15) — the contract does not exist.

## Rholang: the native Proof-of-Stake API

`rho:rchain:pos` is likewise **native** (`rholang/src/system_processes.rs::pos`,
`rholang/src/native_state.rs`). The interpreted `Pos.rhox` is **not installed** on this node
(`spec/GENESIS.md` — it "would shadow consensus-critical logic"), so only this method set exists:

| method | args | notes |
|---|---|---|
| `bond` | `[*deployerId, amount, ret]` | derives the validator from the caller's `deployerId`, so **a key can only bond itself**. **Permissioned**: refuses a key not in the trusted set. |
| `withdraw` | `[*deployerId, ret]` | **stages** an unbond — the validator stays bonded, active and earning until the next epoch boundary, then a `quarantineLength` escrow before payout. |
| `trust` / `untrust` | `[*deployerId, targetPubkeyBytes, ret]` | a trusted stakeholder admits/removes a key; the only way a fresh key becomes bondable. |
| `delegate` | `[*deployerId, operatorPubkeyBytes, amount, ret]` | **delegated stake** (law 57, #193): moves `amount` from the *signer's own* vault onto the **named** operator's `pos:bonds` entry. No commission, no admission step. |
| `undelegate` | `[*deployerId, operatorPubkeyBytes, ret]` | **stages** an undelegation — mirrors `withdraw`: the principal keeps earning (and stays at risk) until the boundary, then a quarantine, then `principal + accrued rewards` to the delegator's own vault. |
| `getBonds` | `[ret]` | `Map[ByteArray(65-byte key) → Int]`, the **aggregate** per key (own stake + delegations). |
| `getActiveValidators` | `[ret]` | `Set[ByteArray]`. |
| `getTrusted` | `[ret]` | `Set[ByteArray]`. |

Every write returns `(Bool, Nil|String)` — the second element is the refusal reason. The
epoch/validator/countdown view does **not** need rholang: `GET /api/v1/pos` (`getPosStatus`)
answers `epochLength`, `quarantineLength`, `epoch`, `blocksUntilEpochBoundary`, `activeValidators`
and `pendingWithdrawals` directly. The wallet's templates:

- `fn_bond(amount)` / `fn_unbond()` → the write above, replying on the term's first `new`-bound name.
- `fn_trust(pubkey_hex, op)` → `"…".hexToBytes()` as the target key.
- `fn_pos_info(pubkey_hex)` → reads `getBonds` **and** `getTrusted` and looks the key up *in rholang*
  (`getOrElse`/`contains`), so the caller never depends on how the node renders a `Map` with
  `ByteArray` keys over JSON.

See the **STAKING** screen (`src/modules/wallet/staking/Staking.tsx`). Delegation (`delegate` /
`undelegate`) lets a key that holds REV stake it on a bonded operator it does not run — the
delegator is the deploy's signer, the operator is a named key, and the delegator's principal shares
the operator's slash risk and its pro-rata rewards.

**Reading a delegation is delegator-scoped.** `GET /api/v1/pos/delegations?delegator=<hex>`
(`getDelegations`) answers one key's positions across every operator it has staked with — amount,
accrued rewards, and a staged undelegation's deadline and countdown. It is deliberately not a field
on `PosStatus`: the ledger is unbounded in delegator count, so the read that is bounded is the one
keyed by the delegator, and the operator-side listing is not offered. A malformed key answers 400
rather than an empty list, because an empty list is a *true answer* about a delegator with no
positions. In rholang the same read is `pos!("getDelegations", delegatorKey, *ret)`.

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
- **Node ESM / CJS interop**: `blakejs` uses `module.exports = { … }` with values
  Node's ESM loader can't statically detect, so it's imported as a **default**
  (`import blake from "blakejs"`) and `blockchain.ts`'s `module_proxy` falls back to
  `.default`. Keep this pattern if you add CJS deps used by the test. The crypto
  libraries (`@noble/curves`, `@scure/bip39`, `@ethereumjs/wallet`) are real ESM and
  are imported normally.
- **Signing**: `src/api/sign.ts` signs with `@noble/curves`, and every `sign`/`verify`
  passes `{ prehash: false }` — since v2 the library SHA-256s its input by default,
  while RChain signs the `blake2b256` digest of the protobuf itself. Drop that flag
  and the wallet produces valid signatures over the wrong digest, which every node
  rejects (see the `test:unit` recovery assertion, and the note in AGENTS.md).
- **`vendored/`** holds the old Scala-era `@tgrospic/rnode-http-js` client, kept as
  reference. Nothing imports it: MetaMask detection lives in `src/utils/metamask.ts`,
  because importing that client's index pulled unmaintained `elliptic`/
  `ethereumjs-util` into the browser bundle.
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
