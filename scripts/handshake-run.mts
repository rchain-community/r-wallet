import fs from "node:fs";
import { deploy } from "../src/utils/rnode";
import { get_account_from_private_key } from "../src/utils/blockchain";
import { formatRhoResult } from "../src/api/rho-json";
import type { NamedWallet } from "../src/utils/utils";

const NODE = "http://localhost:40403";
// The devnet's genesis deployer (tools/devnet.sh: DEPLOYER_PRIV = VALIDATOR_PRIV[0]) — the same
// identity the chain's genesis contracts were installed under, and a real public key, which getMe
// needs to derive a REV address from.
const KEY = "a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76";

const acct = await get_account_from_private_key(KEY);
if (!acct) throw new Error("could not derive the deploy key");
const wallet: NamedWallet & { privKey: string } = { name: "handshake", ...acct, privKey: acct.privKey };

const term = fs.readFileSync("scripts/handshake.rho", "utf-8");
const res = await deploy(NODE, wallet, term, 1_000_000);
console.log(`deployer: ${acct.revAddr}`);
console.log(`err  = ${res.error}`);
console.log(`expr = ${formatRhoResult(res.expr)}`);
