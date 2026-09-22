// Evidence probe: the deployer's REV address, derived two ways.
//
// Traceable from a wallet-side symptom. `claimWithInbox` returns `[]`; staged stdout markers show
// every hop firing and `memberIdGovRev.rho`'s `claim` answering
//   (false, "revAddr must match deployer")
// which stalls `setup` (it only matches `@(true, …)`) and so leaves the pane empty with no error.
// That comparison is `myRevAddr == deployerRevAddr`, where the contract derives the deployer's
// address on-chain (`DeployerIdOps!("pubKeyBytes", …)` then `RevAddress!("fromPublicKey", …)`) and
// `myRevAddr` is what this wallet passes. The two disagree, so this prints both, plus what each
// address is actually worth on the chain:
//
//   npx tsx scripts/probe-deployer-address.mts
//
// Read alongside `casper/src/genesis/resources/rgov/memberIdGovRev.rho`'s `deployerRevAddr` and
// `rholang/src/util/rev_address.rs::from_public_key`.
import { deploy } from "../src/utils/rnode";
import { get_account_from_private_key, get_account_from_public_key } from "../src/utils/blockchain";
import { formatRhoResult } from "../src/api/rho-json";
import type { NamedWallet } from "../src/utils/utils";

const NODE = "http://localhost:40403";
const KEY = "a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76";

const acct = await get_account_from_private_key(KEY);
if (!acct) throw new Error("could not derive the deploy key");
const wallet: NamedWallet & { privKey: string } = { name: "probe", ...acct, privKey: acct.privKey };

console.log("== what this wallet derives from the key ==");
console.log(`  pubKey : ${acct.pubKey}`);
console.log(`  revAddr: ${acct.revAddr}`);
const again = await get_account_from_public_key(acct.pubKey);
console.log(`  re-derived from the pubkey: ${again?.revAddr}  (${again?.revAddr === acct.revAddr ? "same" : "DIFFERENT"})`);

// The address the *node* derives from the same key, read off the chain by asking the same two system
// processes `memberIdGovRev.rho` uses. deployerRevAddr is the contract's own log line, so this also
// re-runs the comparison `claim` refuses on.
const term =
    "match [\"" + acct.revAddr + "\"] {\n" +
    "  [myRevAddr] => {\n" +
    "    new\n" +
    "    deployId(`rho:rchain:deployId`),\n" +
    "    deployerId(`rho:rchain:deployerId`),\n" +
    "    idOps(`rho:rchain:deployerId:ops`),\n" +
    "    RevAddress(`rho:rev:address`),\n" +
    "    revVault(`rho:rchain:revVault`),\n" +
    "    deployerRevAddr,\n" +
    "    pkCh,\n" +
    "    derivedCh,\n" +
    "    mineCh,\n" +
    "    theirsCh\n" +
    "    in {\n" +
    '      idOps!("pubKeyBytes", *deployerId, *pkCh) |\n' +
    "      for (@pkBytes <- pkCh) {\n" +
    '        RevAddress!("fromPublicKey", pkBytes, *derivedCh) |\n' +
    "        for (@nodeRevAddr <- derivedCh) {\n" +
    '          revVault!("getBalance", myRevAddr, *mineCh) |\n' +
    '          revVault!("getBalance", nodeRevAddr, *theirsCh) |\n' +
    "          for (@mine <- mineCh; @theirs <- theirsCh) {\n" +
    "            deployId!([\n" +
    '              "wallet-derived (what claim is handed)", myRevAddr, mine,\n' +
    '              "node-derived (what claim compares against)", nodeRevAddr, theirs,\n' +
    '              "equal", myRevAddr == nodeRevAddr,\n' +
    '              "pubKeyBytes", pkBytes\n' +
    "            ])\n" +
    "          }\n" +
    "        }\n" +
    "      }\n" +
    "    }\n" +
    "  }\n" +
    "}";

const res = await deploy(NODE, wallet, term, 1_000_000);
console.log("\n== what the node derives and what each address holds ==");
console.log(`  err : ${res.error}`);
console.log(`  pane: ${formatRhoResult(res.expr) ?? "(no result)"}`);
