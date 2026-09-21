// The governance master read-capability URI, per network.
//
// This URI is NOT a constant in the old sense: it is the result of deploying the rgov contract
// set (Kudos, Inbox, Directory, member directory/Roll, Issue, Echo, Log) and publishing a master
// directory over them. The original project shipped one `MasterURI.<network>.json` per network
// for exactly this reason, and the previous single hardcoded value was a leftover from an older
// chain — which is why governance snippets stalled and returned `[]`.
//
// Fill an entry by running the bootstrap against that network:
//   npx tsx scripts/bootstrap-rgov.ts --node <url>
// which writes scripts/rgov-bootstrap.<host>.json and prints the master URI.

import { built_in_nodes } from "../utils/globals";
import { get_node_url } from "../utils/networks";

export const MASTER_URI: Record<string, string> = {
    /**
     * https://rnodeapi.rhobot.net — from the upstream rgov record
     * (`rgov/src/MasterURI.rhobot.json`). Whether this chain still has the contract set behind it
     * is what the two-step `GetMe` handshake settles; if it does not, re-bootstrap with
     * `scripts/bootstrap-rgov.ts` and replace this value with the URI it prints.
     */
    rhobot: "rho:id:s5k4ghyjppnehrwk8s3fria5febwck3ekpbuki9wdm9grbmbdiy8js",
    /**
     * A local RNode devnet (`~/RNodeRust`, tools/devnet.sh). Bootstrapped with
     * `scripts/bootstrap-rgov.ts` — the URI belongs to that chain and to no other, because it is
     * the product of deploying the contract set there (see scripts/rgov-bootstrap.localhost_40403.json).
     */
    localhost: "rho:id:ijp71jiretw5y97mkg1swbdbgpfk8bbbq9rpm7n4q5498dhd8u5o",
    /** Upstream ships placeholders here, never bootstrapped — left empty rather than send one. */
    testnet: "",
    mainnet: "",
};

/** The master URI for a network key, or "" when that network has not been bootstrapped. */
export function master_uri_for(network: string | undefined): string {
    if (!network) return "";
    return MASTER_URI[network] ?? "";
}

/**
 * The master URI for a node URL, resolved through the built-in node table. Compare the *resolved*
 * URL: a local node keeps its port in a separate field (`url: "http://localhost"`, `port: 40403`),
 * so matching on `url` alone would never find `http://localhost:40403` and the local table entry
 * would be unreachable.
 */
export function master_uri_for_url(url: string): string {
    const want = url.replace(/\/$/, "");
    const node = built_in_nodes.find(n => get_node_url(n).replace(/\/$/, "") === want);
    return master_uri_for(node?.network);
}
