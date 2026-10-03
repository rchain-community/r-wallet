// shortname: rho

// Rholang to transfer REV via the native `rho:rchain:revVault` system process.
// The `from` vault is derived from the caller's unforgeable `deployerId`
// (rholang/src/system_processes.rs:1383-1427), so no `from` address is passed.
export const fn_transfer_funds = (rev_addr_to: string, amount: number|string) => `
  new revVault(\`rho:rchain:revVault\`), deployerId(\`rho:rchain:deployerId\`), deployId(\`rho:rchain:deployId\`), resultCh in {
    revVault!("transfer", *deployerId, "${rev_addr_to}", ${amount}, *resultCh) |
    for (_ <- resultCh) {
      deployId!((true, "Transfer successful (not yet finalized)."))
    }
  }
`;

// Rholang to check a REV balance via the native `getBalance` method
// (rholang/src/system_processes.rs:1362-1374).
export const fn_check_balance = (rev_addr: string) => `
  new return, revVault(\`rho:rchain:revVault\`), balanceCh in {
    revVault!("getBalance", "${rev_addr}", *balanceCh) |
    for (@balance <- balanceCh) { return!(balance) }
  }
`;

// Rholang to drive the native `rho:rchain:pos` contract (`rholang/src/system_processes.rs::pos`).
// The interpreted Pos.rhox is NOT installed on this node (spec/GENESIS.md), so only the native
// method set exists: bond / withdraw / trust / untrust / getBonds / getActiveValidators /
// getTrusted. `bond` and `withdraw` take the caller's unforgeable `deployerId` — the validator is
// derived from it, so a key can only bond itself.
//
// The PoS reply is `(Bool, Nil|String)` — the second element is the refusal reason. **Where it is
// read from depends on the path** (`spec/API-SCHEMA.md`, rule 3): an *explore* result comes from the
// term's first `new`-bound name, but a *deploy*'s result comes from the deploy's own
// `rho:rchain:deployId` channel. The writers below therefore reply on `deployId` (the same shape as
// `fn_transfer_funds`); a write that replied on its first private name would report nothing, hiding
// the node's refusal.

// Self-bond `amount` REV (drops). Permissioned: the node refuses a key not in the trusted set.
export const fn_bond = (amount: number|string) => `
  new retCh, PoSCh, rl(\`rho:registry:lookup\`), deployerId(\`rho:rchain:deployerId\`), deployId(\`rho:rchain:deployId\`) in {
    rl!(\`rho:rchain:pos\`, *PoSCh) |
    for (@(_, PoS) <- PoSCh) {
      @PoS!("bond", *deployerId, ${amount}, *retCh) |
      for (@result <- retCh) {
        deployId!(result)
      }
    }
  }
`;

// Stage an unbond. The validator stays bonded, active and earning until the next epoch boundary,
// then the bond is escrowed for the quarantine length before it (and accrued rewards) is paid.
export const fn_unbond = () => `
  new retCh, PoSCh, rl(\`rho:registry:lookup\`), deployerId(\`rho:rchain:deployerId\`), deployId(\`rho:rchain:deployId\`) in {
    rl!(\`rho:rchain:pos\`, *PoSCh) |
    for (@(_, PoS) <- PoSCh) {
      @PoS!("withdraw", *deployerId, *retCh) |
      for (@result <- retCh) {
        deployId!(result)
      }
    }
  }
`;

// Admit (`trust`) or remove (`untrust`) a 65-byte validator public key from the trusted set. Only
// an already-trusted stakeholder may do this; it is the only path by which a new key can bond.
export const fn_trust = (pubkey_hex: string, op: "trust"|"untrust") => `
  new retCh, PoSCh, rl(\`rho:registry:lookup\`), deployerId(\`rho:rchain:deployerId\`), deployId(\`rho:rchain:deployId\`) in {
    rl!(\`rho:rchain:pos\`, *PoSCh) |
    for (@(_, PoS) <- PoSCh) {
      @PoS!("${op}", *deployerId, "${pubkey_hex}".hexToBytes(), *retCh) |
      for (@result <- retCh) {
        deployId!(result)
      }
    }
  }
`;

// Delegated stake (law 57, #193). The delegator is the *signer* — `*deployerId` spends the
// delegator's own vault — while the operator is a **named** key (a ByteArray), which is what makes
// this a delegation rather than a self-bond. The principal joins the operator's `pos:bonds` entry
// (the aggregate) and the ledger records which part is whose. There is no commission.
//
// Engages the pool at once and the active set at the next boundary, so a delegation cannot conjure
// a slot mid-epoch. Refused when the operator is not in the pool, when the delegator names itself,
// below `minimum_bond`, or while the operator has a withdrawal pending.

export const fn_delegate = (operator_pubkey_hex: string, amount: number|string) => `
  new retCh, PoSCh, rl(\`rho:registry:lookup\`), deployerId(\`rho:rchain:deployerId\`), deployId(\`rho:rchain:deployId\`) in {
    rl!(\`rho:rchain:pos\`, *PoSCh) |
    for (@(_, PoS) <- PoSCh) {
      @PoS!("delegate", *deployerId, "${operator_pubkey_hex}".hexToBytes(), ${amount}, *retCh) |
      for (@result <- retCh) {
        deployId!(result)
      }
    }
  }
`;

// Stage an undelegation. Mirrors `withdraw`: the principal stays in the operator's pool entry,
// still earning and still at risk, until the boundary moves it into a claim, and it is paid
// `principal + accrued rewards` to the delegator's own vault after the quarantine. Staging rather
// than paying at once is deliberate — undelegating cannot dodge a slash already in flight.
export const fn_undelegate = (operator_pubkey_hex: string) => `
  new retCh, PoSCh, rl(\`rho:registry:lookup\`), deployerId(\`rho:rchain:deployerId\`), deployId(\`rho:rchain:deployId\`) in {
    rl!(\`rho:rchain:pos\`, *PoSCh) |
    for (@(_, PoS) <- PoSCh) {
      @PoS!("undelegate", *deployerId, "${operator_pubkey_hex}".hexToBytes(), *retCh) |
      for (@result <- retCh) {
        deployId!(result)
      }
    }
  }
`;

// Read this key's PoS position in one explore: its bond and whether it is trusted. Read-only —
// `getBonds` / `getTrusted` take no `deployerId`, so this works through explore-deploy.
//
// The lookup is done *in rholang* (`getOrElse` / `contains`) against the key's own bytes, so the
// result is a pair of scalars `(Int, Bool)` and the caller never depends on how the node renders a
// `Map` with `ByteArray` keys over JSON. `-1` means "not bonded" (bonds are non-negative).
export const fn_pos_info = (pubkey_hex: string) => `
  new ret, PoSCh, rl(\`rho:registry:lookup\`), bondsCh, trustedCh in {
    rl!(\`rho:rchain:pos\`, *PoSCh) |
    for (@(_, PoS) <- PoSCh) {
      @PoS!("getBonds", *bondsCh) |
      @PoS!("getTrusted", *trustedCh) |
      for (@bonds <- bondsCh & @trusted <- trustedCh) {
        ret!((bonds.getOrElse("${pubkey_hex}".hexToBytes(), -1),
              trusted.contains("${pubkey_hex}".hexToBytes())))
      }
    }
  }
`;
