// Names the identity that a genesis-installed rgov class captures as its `rho:rchain:deployerId`.
import blakejs from "blakejs";
import { get_account_from_private_key } from "../src/utils/blockchain";

const b2 = (blakejs as unknown as { blake2b: (i: Uint8Array, k: null, n: number) => Uint8Array }).blake2b
    ?? (blakejs as unknown as { default: { blake2b: (i: Uint8Array, k: null, n: number) => Uint8Array } }).default.blake2b;

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
for (const name of ["roll", "directory", "inbox", "kudos", "issue"]) {
    const sk = hex(b2(new TextEncoder().encode(`rnode/genesis/rgov/${name}`), null, 32));
    const acct = await get_account_from_private_key(sk);
    console.log(`${name.padEnd(10)} priv=${sk.slice(0, 16)}… pub=${acct?.pubKey.slice(0, 24)}… rev=${acct?.revAddr}`);
}
