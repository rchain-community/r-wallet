// The genesis-funded accounts' REV addresses — addresses only, no keys. This is the app-facing half
// of the split: the deploy snippets (bundled into the client) build the genesis roll set from these,
// so the browser bundle never carries a private key. The matching keys live in `playground.ts`,
// which only Node scripts import. `npm run test:unit` fails if the two drift apart.

export const GENESIS_ADDRESSES: readonly string[] = [
	"1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK",
	"11112wWGeUA5qt6MpH9CantYj2UWWt4C3LP4cx8TpQmeM79dyen6Sk",
	"1111bRUvDCJ2ZtDMtCYU1ScW19uTRbVd9VHUmtPunMEQzS4oSxEkY",
];
