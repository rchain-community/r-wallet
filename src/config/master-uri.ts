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

export const MASTER_URI: Record<string, string> = {
    /**
     * https://rnodeapi.rhobot.net — from the upstream rgov record
     * (`rgov/src/MasterURI.rhobot.json`). Whether this chain still has the contract set behind it
     * is what the two-step `GetMe` handshake settles; if it does not, re-bootstrap with
     * `scripts/bootstrap-rgov.ts` and replace this value with the URI it prints.
     */
    rhobot: "rho:id:s5k4ghyjppnehrwk8s3fria5febwck3ekpbuki9wdm9grbmbdiy8js",
    /**
     * A local RNode devnet (`~/RNodeRust`, tools/devnet.sh) — from the upstream record
     * (`rgov/src/MasterURI.localhost.json`), written by its own `bootstrap/deploy-all`. A fresh
     * devnet has no such contracts, so bootstrap it to get a URI that belongs to *that* chain.
     */
    localhost: "rho:id:ao5pwhsj6sjtequ47oo8d6jw4dyu7fk89nmzsofjxz7j1d68go58ao",
    /** Upstream ships placeholders here, never bootstrapped — left empty rather than send one. */
    testnet: "",
    mainnet: "",
};

/** The master URI for a network key, or "" when that network has not been bootstrapped. */
export function master_uri_for(network: string | undefined): string {
    if (!network) return "";
    return MASTER_URI[network] ?? "";
}

/** The master URI for a node URL, resolved through the built-in node table. */
export function master_uri_for_url(url: string): string {
    const node = built_in_nodes.find(n => n.url.replace(/\/$/, "") === url.replace(/\/$/, ""));
    return master_uri_for(node?.network);
}
