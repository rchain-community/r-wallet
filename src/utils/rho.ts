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

// Rholang code to bond a validator
export const fn_bond = (amount: number|string) => `
  new retCh, PoSCh, rl(\`rho:registry:lookup\`), stdout(\`rho:io:stdout\`) in {
    stdout!("About to lookup pos contract...") |

    rl!(\`rho:rchain:pos\`, *PoSCh) |

    for(@(_, PoS) <- PoSCh) {
      stdout!("About to bond...") |

      @PoS!("bond", ${amount}, *retCh) |
      for ( ret <- retCh) {
        stdout!("PoS return!") |
        match *ret {
          {(true, message)} => stdout!(("BOND_SUCCESS", "Successfully bonded!", message))

          {(false, message)} => stdout!(("BOND_ERROR", message))
        }
      }
    }
  }
`;
