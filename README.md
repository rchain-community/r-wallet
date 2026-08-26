# R Wallet

**R Wallet** is a browser wallet for the RChain **REV** token and a
**WYSIWYG rholang deployer**. It is a single-page app that talks directly to a
[Rust RNode](https://github.com/rchain-community/RNodeRust)'s HTTP API — no gRPC,
no backend proxy.

- **Write & deploy rholang visually** — a Monaco code editor with `EXPLORE`
  (read-only evaluation), `ADMIN DEPLOY` (on-chain), and `PROPOSE`.
- **Contract templates** — a dropdown of governance/smart-contract templates with
  field auto-fill and an inline **EXPLAIN** panel (what each template and field does).
- **REV wallet** — check balance, transfer REV, and access wallets via keystore
  file, mnemonic phrase, private key, MetaMask, or a locally-stored wallet.
- **Devnet faucet** — one click to fund a fresh address on a local devnet.

## The rgov successor

R Wallet is the modern successor to [rgov](https://github.com/rchain-community/rgov),
RChain's earlier governance / liquid-democracy app. rgov's dev interface was a
rholang deployer with a dropdown of governance contract templates; R Wallet carries
those templates forward in a fresh React/Vite UI and adds the wallet layer that
rgov lacked.

The governance templates map to liquid-democracy primitives:

- **Ballot / Issue / Vote** — proposals, voting, vote delegation, and tallying.
- **Group / MemberDirectory / Roll** — membership and voter registration.
- **Inbox / Chat / Mail / Share** — messaging between members.
- **Kudos** — a peer-to-peer trust metric.
- **Mint** — issuing a community token.

rgov had no first-class wallet: R Wallet adds REV balance/transfer and a devnet
faucet, and talks directly to the Rust RNode HTTP API.

## Stack

React 18 · TypeScript · Vite · Tailwind CSS · Monaco (`@monaco-editor/react`) ·
react-router. The API client is first-party (`src/api`) and typed against the
node's HTTP contract.

## Quick start

```bash
npm install
npm start          # dev server at http://localhost:5173
```

To use it against a real node, run a local devnet (from `~/RNodeRust`):

```bash
cd ~/RNodeRust
tools/devnet.sh build
tools/devnet.sh up --validators 1   # public HTTP 40403, admin HTTP 40405
```

Then in the app, select the `localhost-0` node.

## Routes

`/` (editor) · `/access` (wallet access) · `/balance` · `/transfer` · `/settings`

## Build

```bash
npm run build      # tsc + vite build → dist/
npm run test:api   # integration test of the API client against a running devnet
```

## Documentation

- **[`docs/DEVELOPER.md`](docs/DEVELOPER.md)** — architecture, the HTTP API
  contract, deploy signing, the native `revVault` rholang, testing, and gotchas.
- **[`AGENTS.md`](AGENTS.md)** — AI-agent entrypoint and conventions.

## License

See `LICENSE`.
