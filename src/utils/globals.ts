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
	target_account: u.NamedWallet
) {
	if (!from_account) { return null; }
	if (!target_account) { return null; }
	let url = ctx.get_validator_url();
	return await (await rnode).transfer(url, from_account, target_account, amount);
}

export async function deploy_code(
	ctx: NodeContext,
	code: string,
	phlo_limit: number,
	attachments: string[] = []
) {
	if (!user) { return null; }
	let url = ctx.get_validator_url();
	return await (await rnode).deploy(url, user, code, phlo_limit, attachments);
}

export async function propose(
	ctx: NodeContext
) {
	if (!user) { return null; }
	let url = ctx.get_admin_url();
	return await (await rnode).propose(url);
}

// --- Proof of Stake -----------------------------------------------------------

export async function pos_status(ctx: NodeContext) {
	const { getPosStatus } = await import("../api/client");
	return await getPosStatus(ctx.get_readonly_url());
}

export async function check_pos(ctx: NodeContext, pubkey_hex: string) {
	let url = ctx.get_readonly_url();
	return await (await rnode).check_pos(url, pubkey_hex);
}

export async function delegations(ctx: NodeContext, delegator_pubkey_hex: string) {
	const { getDelegations } = await import("../api/client");
	return await getDelegations(ctx.get_readonly_url(), delegator_pubkey_hex);
}

export async function bond(ctx: NodeContext, amount: number) {
	if (!user) { return null; }
	let url = ctx.get_validator_url();
	return await (await rnode).bond(url, user, amount);
}

export async function unbond(ctx: NodeContext) {
	if (!user) { return null; }
	let url = ctx.get_validator_url();
	return await (await rnode).unbond(url, user);
}

export async function trust_key(
	ctx: NodeContext,
	pubkey_hex: string,
	op: "trust" | "untrust"
) {
	if (!user) { return null; }
	let url = ctx.get_validator_url();
	return await (await rnode).trust_key(url, user, pubkey_hex, op);
}

export async function delegate(ctx: NodeContext, operator_pubkey_hex: string, amount: number) {
	if (!user) { return null; }
	let url = ctx.get_validator_url();
	return await (await rnode).delegate(url, user, operator_pubkey_hex, amount);
}

export async function undelegate(ctx: NodeContext, operator_pubkey_hex: string) {
	if (!user) { return null; }
	let url = ctx.get_validator_url();
	return await (await rnode).undelegate(url, user, operator_pubkey_hex);
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
	if (!ctx.capabilities?.faucet) { return null; }
	let url = ctx.get_validator_url();
	const { faucet: faucet_funds } = await import("../api/faucet");
	try {
		const res = await faucet_funds(url, user.revAddr);
		return { deployId: res.deployId, error: null };
	} catch (err) {
		return { deployId: null, error: u.error_string(err) };
	}
}

export let user: u.UserWallet | u.UserMetaMaskWallet | null = null;

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

export function set_active_user(account: u.UserWallet | u.UserMetaMaskWallet) {
	user = account;
}
