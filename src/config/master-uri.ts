import { built_in_nodes } from "../utils/globals";
import { get_node_url } from "../utils/networks";

/**
 * The governance master read-capability URI — now a **constant of the port**, not of a chain.
 *
 * The rgov set is installed at genesis, and genesis content is signed with fixed keys and timestamps,
 * so the read cap is the same value on every chain built from this port (the manifest and constants
 * are in the node repo's `spec/GENESIS.md`). That is what removes the old per-chain bootstrapping: a
 * fresh chain carries the governance contracts and this URI from block 0 — no deploy, no funding, and
 * no provenance to get wrong, which is where the previous per-chain value led consumers astray.
 */
export const PORT_READ_CAP = "rho:id:wxc4mwdh7otq4fd6iuxt84inepssyz5tugojf7ao68dkh4ebbncy";

export const MASTER_URI: Record<string, string> = {
    /** A chain built from a genesis-carrying revision of the node — the constant above. */
    localhost: PORT_READ_CAP,
    /**
     * The rholang playground. It used to need its own runtime-bootstrapped uri
     * (`rho:id:s5k4ghy…`), but its chain was rebuilt on 2026-09-22 from a
     * genesis-carrying revision, so it takes the port constant like every
     * other such chain — exactly the redeploy this comment used to anticipate.
     * Verified on the rebuilt chain: PORT_READ_CAP returns
     * `Directory, Echo, GetMe, Inbox, Issue, Kudos, Log, Roll, SendThem`,
     * while the old uri resolves but reads empty.
     */
    rhobot: PORT_READ_CAP,
    /**
     * testnet.rhobot.net carries the governance set at GENESIS, so it uses the
     * port constant. Verified against the live chain: a lookup of
     * PORT_READ_CAP there returns a directory of
     * `Directory, Echo, GetMe, Inbox, Issue, Kudos, Log, Roll, SendThem`,
     * while the legacy rhobot uri resolves but reads empty.
     */
    testnet: PORT_READ_CAP,
    mainnet: "",
};

/** The master URI for a network key, or "" when that network has no known governance set. */
export function master_uri_for(network: string | undefined): string {
    if (!network) return "";
    return MASTER_URI[network] ?? "";
}

/**
 * The master URI for a node URL, resolved through the built-in node table. Compare the *resolved*
 * URL: a local node keeps its port in a separate field (`url: "http://localhost"`, `port: 40403`),
 * so matching on `url` alone would never find `http://localhost:40403` and the local entry would be
 * unreachable.
 */
export function master_uri_for_url(url: string): string {
    const want = url.replace(/\/$/, "");
    const node = built_in_nodes.find(n => get_node_url(n).replace(/\/$/, "") === want);
    return master_uri_for(node?.network);
}
