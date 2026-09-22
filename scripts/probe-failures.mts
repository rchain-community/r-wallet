// Evidence pack for the cases whose pane is not JSON: the term the *editor* builds (snippet_apply
// over the args the harness fills) and the raw reply the wallet's own seam returns. Run:
//   npx tsx scripts/probe-failures.mts [snippet …]
import { snippets, snippet_apply, snippet_meta, common_field_defaults } from "../src/modules/wallet/deploy/snippets";
import { deploy } from "../src/utils/rnode";
import { get_account_from_private_key } from "../src/utils/blockchain";
import { formatRhoResult } from "../src/api/rho-json";
import type { NamedWallet } from "../src/utils/utils";

const NODE = "http://localhost:40403";
const KEY = "a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76";
const MASTER = "rho:id:wxc4mwdh7otq4fd6iuxt84inepssyz5tugojf7ao68dkh4ebbncy";

const acct = await get_account_from_private_key(KEY);
if (!acct) throw new Error("could not derive the deploy key");
const wallet: NamedWallet & { privKey: string } = { name: "probe", ...acct, privKey: acct.privKey };

const ARGV = process.argv.slice(2);
const TARGETS = ARGV.length > 0
    ? ARGV
    : ["addMember", "sendMail", "claimWithInbox", "share", "getRoll", "checkRegistration"];

for (const name of TARGETS) {
    const snippet = snippets[name as keyof typeof snippets];
    if (!snippet) {
        console.log(`no such snippet: ${name}`);
        continue;
    }
    const defaults =
        (snippet_meta[name as keyof typeof snippets] as { defaults?: Record<string, string> })?.defaults ?? {};
    const args = snippet.fields.map(f => {
        const d = defaults[f.name] ?? common_field_defaults[f.name];
        if (d !== undefined) return d;
        if (f.type === "MasterURI" || f.type === "uri") return MASTER;
        if (f.type === "walletRevAddr") return acct.revAddr;
        if (f.type === "number") return "1";
        if (f.type === "set") return "1, 2";
        return "test";
    });
    const term = snippet_apply(name as keyof typeof snippets, args);

    console.log(`\n=== ${name}  args=${JSON.stringify(args)}`);
    console.log(term.split("\n").map(l => `    ${l}`).join("\n"));
    const res = await deploy(NODE, wallet, term, 1_000_000);
    console.log(`  err : ${res.error}`);
    console.log(`  pane: ${formatRhoResult(res.expr)?.replace(/\n/g, " ")}`);
}
