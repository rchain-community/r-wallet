// Pre-funded testnet wallets, offered alongside the faucet so a visitor can start
// from a funded account without waiting on a drip.
//
// WARNING: these private keys are published in client source on purpose, so every
// visitor to a deployed build can read them and spend these balances. The funds are
// disposable testnet REV and nothing else. Never reuse these keys anywhere, and never
// put anything of value on this network.
//
// The addresses are each account's REV address as derived from its key; `npm run
// test:unit` re-derives them and fails if a key and address drift apart.

export interface PlaygroundAccount {
	name: string;
	privKey: string;
	revAddr: string;
}

/** Network the balances live on — shown in the UI so nobody expects funds elsewhere. */
export const PLAYGROUND_NETWORK = "Rhobot testnet";

export const PLAYGROUND_ACCOUNTS: PlaygroundAccount[] = [
	{
		name: "alice",
		privKey: "0b60b3ffcc43a607e037c3da3c1ed366261d742288abdf92d53cf80b9e3cf98f",
		revAddr: "1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK",
	},
	{
		name: "bob",
		privKey: "13487106542b1c1472c4af4bf29031ecbad42464a82e38b6f0e18a09bbf54f12",
		revAddr: "11112wWGeUA5qt6MpH9CantYj2UWWt4C3LP4cx8TpQmeM79dyen6Sk",
	},
	{
		name: "carol",
		privKey: "babf57fd43a2c5b46596fa24f20e7f4b7892f66c5d0413f146cac2b9ce9ea902",
		revAddr: "1111bRUvDCJ2ZtDMtCYU1ScW19uTRbVd9VHUmtPunMEQzS4oSxEkY",
	},
];

/**
 * Pick a random account, avoiding `exclude_revAddr` when there is another option (so
 * clicking twice in a row doesn't hand back the same wallet). `rand` is injectable so
 * the unit suite can pin the selection deterministically.
 */
export function pick_random_account(
	exclude_revAddr?: string,
	rand: () => number = Math.random
): PlaygroundAccount | null {
	if (PLAYGROUND_ACCOUNTS.length === 0) { return null; }

	let candidates = PLAYGROUND_ACCOUNTS;
	if (exclude_revAddr) {
		let remaining = PLAYGROUND_ACCOUNTS.filter(a => a.revAddr !== exclude_revAddr);
		if (remaining.length > 0) { candidates = remaining; }
	}

	let index = Math.floor(rand() * candidates.length);
	if (!(index >= 0) || index >= candidates.length) { index = 0; }

	return candidates[index];
}
