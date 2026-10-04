// "Login with faucet": generate a brand-new wallet, save its keystore, fund it from the node's
// faucet, and make it the active wallet. The no-key entry point on /access.
//
// Unlike the old pre-funded card, no published key is involved: the wallet is fresh, and the node
// funds it server-side from its devnet deployer (see `globals.faucet` / `api/faucet.ts`). The
// wallet is session-only, like the other access flows: a reload drops it, and the downloaded
// keystore file is the way back in.

import type { NavigateFunction } from "react-router-dom";
import type { LayoutContext, NodeContext } from "Context";
import * as bc from "./blockchain";
import * as g from "./globals";
import * as notif from "./notifications";
import { download_blob } from "./utils";

export async function login_with_faucet(
	ctx: NodeContext,
	password: string,
	layout: LayoutContext,
	navigate: NavigateFunction
): Promise<void> {
	let wallet = await bc.create_account();
	if (!wallet) {
		layout.push_notif({
			group_id: "faucet-login-error",
			content: notif.info("Error", "Failed to generate a wallet.")
		});
		return;
	}

	// Back up the keystore *before* funding: the private key exists nowhere else yet.
	let keystore = await bc.generate_keystore(wallet.privKey, password);
	if (!keystore) {
		layout.push_notif({
			group_id: "faucet-login-error",
			content: notif.info("Error", "Failed to generate the keystore file.")
		});
		return;
	}
	download_blob(keystore.blobUrl, keystore.name);

	g.set_active_user(g.create_user("My Wallet", password, wallet));

	// Fund it. A failure here leaves a valid (unfunded) wallet rather than nothing, so warn and
	// continue instead of rolling back — the user still has a usable wallet and its keystore.
	let res = await g.faucet(ctx);
	if (!res || res.error) {
		layout.push_notif({
			group_id: "faucet-login-error",
			content: notif.info("Wallet created", `Faucet failed: ${res?.error ?? "no faucet on this node"}`)
		});
	} else {
		layout.push_notif({
			group_id: "faucet-login-success",
			content: notif.info("Wallet created", "Funds are on the way — your balance updates after the block is proposed.")
		});
	}

	navigate("/balance");
}
