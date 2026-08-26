// shortname: g
import * as u from './utils';
import * as nw from './networks';
import { type NodeContext } from "Context";

const rnode = import("./rnode");

export let built_in_nodes = [
	...nw.r_nodes,
	...nw.local_nodes,
];

export async function check_balance(ctx: NodeContext) {
	if (!user) { return null; }
	let url = ctx.get_readonly_url();
	return await (await rnode).check_balance(url, user.revAddr);
}

export async function transfer(
	ctx: NodeContext,
	amount: number,
	from_account: u.NamedWallet,
	target_account: u.NamedWallet,
	cancel?: ()=>boolean
) {
	if (!from_account) { return null; }
	if (!target_account) { return null; }
	let url = ctx.get_validator_url();
	return await (await rnode).transfer(url, from_account, target_account, amount, cancel);
}

export async function deploy_code(
	ctx: NodeContext,
	code: string,
	phlo_limit: number,
	cancel?: ()=>boolean
) {
	if (!user) { return null; }
	let url = ctx.get_validator_url();
	return await (await rnode).deploy(url, user, code, phlo_limit, cancel);
}

export async function propose(
	ctx: NodeContext
) {
	if (!user) { return null; }
	let url = ctx.get_admin_url();
	return await (await rnode).propose(url);
}


export async function explore_code(
	ctx: NodeContext,
	code: string,
) {
	if (!user) { return null; }
	let url = ctx.get_readonly_url();
	return await (await rnode).explore(url, code);
}

export async function faucet(
	ctx: NodeContext
) {
	if (!user) { return null; }
	if (!ctx.node.faucet) { return null; }
	let url = ctx.get_validator_url();
	const { faucet: faucet_funds } = await import("../api/faucet");
	try {
		const res = await faucet_funds(url, user.revAddr);
		return { deployId: res.deployId, error: null };
	} catch (err) {
		return { deployId: null, error: u.error_string(err) };
	}
}

export let user_list: u.UserWallet[] = [];
export let user: u.UserWallet | u.UserMetaMaskWallet | null = null;
export let wallet_list: u.NamedWallet[] = [];

export function restore_user_list() {
	let stored_user_list = u.get_local('user-list', []);
	if (stored_user_list !== null) {
		for (let user of stored_user_list) {
			user_list.push(user);
		}
	}

	let stored_wallet_list = u.get_local('wallet-list', []);
	if (stored_wallet_list !== null) {
		for (let wallet of stored_wallet_list) {
			wallet_list.push(wallet);
		}
	}
}

export function create_user(
	name: string,
	password: string,
	wallet: u.PrivateWallet
): u.UserWallet {
	return {
		...wallet,
		name, password,
	};
}

export function create_user_metamask(
	wallet: u.MetaMaskWallet
): u.UserMetaMaskWallet {
	return {
		...wallet,
		name: "My Wallet",
		password: "",
		is_metamask: true
	};
}

export function wallet_index(wallets: u.NamedWallet[], wallet: u.NamedWallet | string) {
	let index = -1;

	if (typeof wallet == "string") {
		index = wallets.findIndex(w => {
			return w.name === wallet ||
				w.revAddr === wallet;
		});
	} else {
		index = wallets.findIndex(w => {
			return w.name === wallet.name ||
				w.revAddr === wallet.revAddr;
		});
	}

	return index;
}

export function wallet_exists(wallets: u.NamedWallet[], wallet: u.NamedWallet | string) {
	return wallet_index(wallets, wallet) !== -1;
}

export function set_active_user(account: u.UserWallet | u.UserMetaMaskWallet) {
	if (account.password || u.wallet_is_metamask(account)) {
		user = account;
		return;
	}

	let existing = user_list.find(u => u.privKey === account.privKey);
	if (existing) {
		user = existing;
		return;
	}

	user = account;
}

export function remove_user(user: u.UserWallet) {
	let index = wallet_index(user_list, user);
	if (index !== -1) {
		user_list.splice(index, 1);
	}
}

export function clear_users() {
	while (user_list.length > 0) {
		user_list.pop();
	}
	u.set_local('user-list', user_list);
}

export function add_user(wallet: u.UserWallet) {
	if (!wallet_exists(user_list, wallet)) {
		user_list.push(wallet);
		u.set_local('user-list', user_list);
		return true;
	}

	return false;
}

export function add_wallet(wallet: u.NamedWallet) {
	if (!wallet_exists(wallet_list, wallet)) {
		wallet_list.push(wallet);
		u.set_local('wallet-list', wallet_list);
	}
}
