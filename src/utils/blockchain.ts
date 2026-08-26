// shortname: bc
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from '@scure/bip39/wordlists/english';
import { PublicWallet, PrivateWallet, MetaMaskWallet } from "./utils";

const _ethereumjs_wallet = import("ethereumjs-wallet");
const _Wallet = _ethereumjs_wallet.then(w => w.default);
const _HDKey = _ethereumjs_wallet.then(w => w.hdkey);

const prefix = { coinId: "000000", version: "00" } as const;

let _secp256k1: import("elliptic").ec | null = null;
async function secp256k1(): Promise<import("elliptic").ec> {
	if (_secp256k1 == null) {
		const mod = (await import("elliptic")) as any;
		const ec = (mod.default ?? mod).ec;
		_secp256k1 = new ec("secp256k1");
	}
	return _secp256k1!;
}

type AsyncModule<PKG extends {}> = {
	[KEY in keyof PKG]:
		PKG[KEY] extends (...args: infer ARGS) => infer RET
			? (...args: ARGS) => Promise<RET>
		: never;
}

function module_proxy<K extends {}>(imported_package: Promise<K>): AsyncModule<K> {
	return new Proxy(
		{}, {
			get(_, prop, __) {
				let pkg: any = null;
				return async function(...args: any) {
					if (pkg == null) {
						pkg = await imported_package;
					}
					const mod = (pkg.default ?? pkg) as any;
					const fn = mod[prop as keyof K] as any;
					return await fn(...args);
				}
			}
		}
	) as AsyncModule<K>;
}

const eth_util = module_proxy(import("ethereumjs-util"));
const bs58 = module_proxy(import("bs58"));
const jssha = module_proxy(import("js-sha3"));
const blakejs = module_proxy(import("blakejs"));

export function generate_mnemonic(strength: number) {
	return generateMnemonic(wordlist, strength);
}

async function base58_from_hex(hex_str: string) {
	return await bs58.encode(await eth_util.toBuffer(hex_str));
}

async function decode_base58(str: string) {
	try {
		return await bs58.decode(str);
	} catch {
		return undefined;
	}
}

export function create_blob(obj: any, mime?: string) {
	const str = typeof obj !== "string" ? JSON.stringify(obj) : obj;
	const blob = new Blob([str], { type: mime });
	return window.URL.createObjectURL(blob);
}

export interface KeystoreFile {
	blobUrl: string;
	name: string;
};

export async function create_keystore(password: string) {
	if (!password || password === '') { return null; }
	const Wallet = await _Wallet;

	const wallet = Wallet.generate();
	const res = await wallet.toV3(password, {
		kdf: 'scrypt',
		n: 131072
	});

	return {
		blobUrl: create_blob(res),
		name: wallet.getV3Filename()
	} as KeystoreFile;
}

export async function generate_keystore(pkey: string, password: string) {
	const Wallet = await _Wallet;

	if (!password || password === '') { return null; }

	if (!pkey.startsWith("0x")) { pkey = "0x" + pkey; }
	let buf: Buffer;
	try {
		buf = await eth_util.toBuffer(pkey);
	} catch (err) {
		console.log(err);
		return null;
	}

	const wallet = Wallet.fromPrivateKey(buf);
	const res = await wallet.toV3(password, {
		kdf: 'scrypt',
		n: 131072
	});

	return {
		blobUrl: create_blob(res),
		name: wallet.getV3Filename()
	};
}

async function unlock_keystore(
	file: Record<string, any>,
	password: string
) {
	const normalized: Record<string, any> = {};
	Object.keys(file).forEach(key => {
		normalized[key.toLowerCase()] = file[key];
	});

	try {
		const Wallet = await _Wallet;

		if (normalized.encseed != null) {
			return Wallet.fromEthSale(normalized as any, password);
		}

		if (normalized.Crypto != null || normalized.crypto != null) {
			return await Wallet.fromV3(normalized as any, password, true);
		}
	} catch {
		return null;
	}

	return null;
}

export async function get_account_from_keystore(
	file: {[member: string]: any},
	password: string
) {
	const unlocked = await unlock_keystore(file, password);
	if (!unlocked) { return null; }
	const pkey = unlocked.getPrivateKeyString();

	return await get_account_from_private_key(pkey);
}

async function get_account_from_eth(eth_addr: string): Promise<PublicWallet | null> {
	if (!eth_addr) { return null; }
	if (eth_addr[0] != "0" || eth_addr[1] != "x") {
		eth_addr = "0x" + eth_addr;
	}
	if (eth_addr.length !== 42) { return null; }

	const eth_hash = await jssha.keccak256(await eth_util.toBuffer(eth_addr));
	const payload = `0x${prefix.coinId}${prefix.version}${eth_hash}`;
	const checksum = (await blakejs.blake2bHex(await eth_util.toBuffer(payload), undefined, 32)).slice(0, 8);

	let rev_addr = await base58_from_hex(`${payload}${checksum}`);
	return {
		revAddr: rev_addr,
		ethAddr: eth_addr
	};
}

export async function get_account_from_metamask() {
	const { ethDetected, ethereumAddress } = await import("../../vendored/@tgrospic/rnode-http-js/src");

	if (!ethDetected) { return null; }
	try {
		let eth_addr = await ethereumAddress();

		let acc = await get_account_from_eth(eth_addr);
		if (!acc) { return null; }

		let mm_acc: MetaMaskWallet = { ...acc, ethAddr: eth_addr, is_metamask: true };
		return mm_acc;
	} catch (err) {
		console.log(err);
		return null;
	}
}

export async function get_account_from_public_key(pub_key: string) {
	if (!pub_key) { return null; }

	if (pub_key[0] != "0" || pub_key[1] != "x") {
		pub_key = "0x" + pub_key;
	}
	if (pub_key.length !== 132) { return null; }

	const pub_key_bytes = (await eth_util.toBuffer(pub_key)).slice(1);
	const pub_key_hash = (await jssha.keccak256(pub_key_bytes)).slice(-40);

	const acc = await get_account_from_eth(pub_key_hash);
	return acc;
}

export async function get_account_from_mnemonic(mnemonic: string): Promise<PrivateWallet | null> {
	const HDKey = await _HDKey;
	let seed = await mnemonicToSeed(mnemonic);
	let hd_wallet = HDKey.fromMasterSeed(await eth_util.toBuffer(seed));
	let key = hd_wallet.derivePath("m/44'/60'/0'/0/0");

	const acc = await get_account_from_private_key(key.getWallet().getPrivateKeyString());
	if (!acc) { return null; }

	return {
		...acc,
		mnemonic: mnemonic
	};
}

export async function get_account_from_private_key(private_key: string): Promise<PrivateWallet | null> {
	if (!private_key) { return null; }
	private_key = private_key.replace(/^0x/, "");
	if (private_key.length !== 64) { return null; }

	const key = (await secp256k1()).keyFromPrivate(private_key);
	const pub_key = key.getPublic('hex');
	const addr = await get_account_from_public_key(pub_key);

	if (!addr) { return null; }
	return {
		pubKey: pub_key,
		privKey: private_key,
		ethAddr: addr.ethAddr,
		revAddr: addr.revAddr,
	};
}

export async function is_valid_rev_address(rev_addr: string) {
	const rev_bytes = await decode_base58(rev_addr);
	if (!rev_bytes) { return false; }

	const rev_hex = await eth_util.bufferToHex(rev_bytes);
	const payload = rev_hex.slice(0, -8);
	const checksum = rev_hex.slice(-8);

	const payload_bytes = await eth_util.toBuffer(payload);
	const blake2bHex = (await import("blakejs")).blake2bHex;
	const checksum_calc = blake2bHex(payload_bytes, undefined, 32).slice(0, 8);

	return checksum === checksum_calc;
}

export async function is_valid_private_key(private_key: string) {
	try {
		if (await eth_util.isValidPrivate(await eth_util.toBuffer(private_key))) {
			return private_key;
		}
	} catch {
		try {
			let private_key_with_hex = await eth_util.addHexPrefix(private_key);
			if (await eth_util.isValidPrivate(await eth_util.toBuffer(private_key))) {
				return private_key_with_hex;
			}
		} catch {}
	}

	return "";
}

export function is_valid_mnemonic(phrase: string) {
	return validateMnemonic(phrase, wordlist);
}

export async function create_account() {
	const key = (await secp256k1()).genKeyPair();
	const private_key = key.getPrivate('hex');
	return await get_account_from_private_key(private_key);
}

export async function get_account(text: string) {
	const val = text.replace(/^0x/, '').trim();
	const is_rev = await is_valid_rev_address(val);
	if (is_rev) {
		return {
			revAddr: val,
		};
	}

	const from_private = await get_account_from_private_key(val);
	if (from_private) {
		return from_private;
	}

	const from_public  = await get_account_from_public_key(val);
	if (from_public) {
		return from_public;
	}

	const from_eth = await get_account_from_eth(val);
	if (from_eth) {
		return from_eth;
	}

	return null;
}
