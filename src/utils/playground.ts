// Activation of a pre-funded testnet (playground) account. Shared by the landing
// card and the account picker so both behave identically.
//
// Access is session-only, matching the private-key and mnemonic flows: the derived
// wallet is set active but not written to the stored user list, so a reload drops it.

import type { NavigateFunction } from "react-router-dom";
import type { LayoutContext } from "Context";
import type { PlaygroundAccount } from "../config/playground";
import * as bc from "./blockchain";
import * as g from "./globals";
import * as notif from "./notifications";

/** Derive `account`, make it the active wallet, and go to the balance page. */
export async function activate_account(
	account: PlaygroundAccount,
	layout: LayoutContext,
	navigate: NavigateFunction
): Promise<void> {
	let wallet = await bc.get_account_from_private_key(account.privKey);

	if (!wallet) {
		layout.push_notif({
			group_id: "access-playground-error",
			content: notif.info("Error", `Failed to derive the "${account.name}" wallet.`)
		});
		return;
	}

	g.set_active_user(g.create_user(account.name, "", wallet));
	navigate("/balance");
}
