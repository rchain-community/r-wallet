// Genesis-funded testnet accounts — the *keys* half. Node-only: nothing under `src/modules` or
// `src/components` may import this, or the private keys land in the browser bundle. The app-facing
// addresses live in `genesis-addresses.ts`; `npm run test:unit` fails if the two drift apart.
//
// The first key is the remote deployer used by `scripts/bootstrap-rgov.ts` and by the API tests.
// These keys are published in the repo on purpose (the funds are disposable testnet REV), but they
// are still keys: never put anything of value on this network, and never reuse them anywhere.
//
// Each `revAddr` is its account's REV address as derived from `privKey`; `npm run test:unit`
// re-derives them and fails if a key and address drift apart.

export interface PlaygroundAccount {
	name: string;
	privKey: string;
	revAddr: string;
}

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
