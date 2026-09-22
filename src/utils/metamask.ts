// The MetaMask (EIP-1193) surface this app actually uses: is a provider injected, and which account
// has the user selected.
//
// This replaces the app's only remaining import from `vendored/@tgrospic/rnode-http-js`, the legacy
// Scala-era client. That package's index re-exports its signing modules, which import `elliptic` and
// `ethereumjs-util` — both unmaintained, both carrying advisories with no patched release — so
// importing it for a two-line provider check pulled an unmaintained ECDSA implementation into the
// browser bundle. `vendored/` stays on disk as the reference it is (see AGENTS.md); nothing builds
// on it.
//
// The behaviour is the vendored module's, deliberately: `ethDetected` is truthiness of the injected
// provider, and the address is the first of `eth_requestAccounts`.

type EthRequestName = "eth_requestAccounts" | "personal_sign";

interface InjectedProvider {
    request(args: { method: EthRequestName; params?: unknown[] }): Promise<unknown>;
    autoRefreshOnNetworkChange?: boolean;
}

function provider(): InjectedProvider | undefined {
    return (globalThis as { ethereum?: InjectedProvider }).ethereum;
}

/** Is a MetaMask-like provider injected into this page? */
export const ethDetected = !!provider();

// Matches the vendored module: opt out of MetaMask's own network-change refresh.
if (ethDetected) {
    const eth_ = provider();
    if (eth_) { eth_.autoRefreshOnNetworkChange = false; }
}

async function eth_request(method: EthRequestName, params?: unknown[]): Promise<unknown> {
    const eth_ = provider();
    if (!eth_) { throw new Error("Ethereum (MetaMask) not detected."); }
    return await eth_.request({ method, params });
}

/**
 * The account selected in MetaMask. The first call asks the user for permission, so this must only
 * be called from a user gesture.
 */
export async function ethereumAddress(): Promise<string> {
    const accounts = await eth_request("eth_requestAccounts");
    if (!Array.isArray(accounts)) {
        throw new Error(`Ethereum RPC response is not a list of accounts (${accounts}).`);
    }
    return accounts[0] as string;
}
