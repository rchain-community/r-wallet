// shortname: bc
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ethDetected, ethereumAddress } from "./metamask";
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from '@scure/bip39/wordlists/english';
import { PublicWallet, PrivateWallet, MetaMaskWallet } from "./utils";

// `@ethereumjs/wallet` is the maintained successor of `ethereumjs-wallet`, which is unmaintained
// and pins a vulnerable `uuid@8`. The API this file uses is unchanged; in v10 `hdkey` exports the
// `EthereumHDKey` class that the call sites below already derive through.
const _ethereumjs_wallet = import("@ethereumjs/wallet");
const _Wallet = _ethereumjs_wallet.then(w => w.Wallet);
const _HDKey = _ethereumjs_wallet.then(w => w.hdkey.EthereumHDKey);

const prefix = { coinId: "000000", version: "00" } as const;

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

// Replaces `ethereumjs-util`, of which this file used exactly four functions: `toBuffer`,
// `bufferToHex`, `isValidPrivate` and `addHexPrefix` — hex/bytes conversions, not cryptography. The
// one security-relevant check, `isValidPrivate`, delegates to the curve library rather than
// restating the curve order here. `Uint8Array`, not `Buffer`: the browser bundle no longer carries
// Node polyfills, so a stray `Buffer` would fail at run time in the app.
function hex_of(bytes: Uint8Array): string {
	return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function to_buffer(value: string | Uint8Array): Uint8Array {
	if (typeof value !== "string") { return value; }
	const hex = value.startsWith("0x") ? value.slice(2) : value;
	if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
		throw new Error(`expected a hex string, got ${value}`);
	}
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) { out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16); }
	return out;
}

const eth_util = {
	toBuffer: to_buffer,
	bufferToHex: (bytes: Uint8Array) => "0x" + hex_of(bytes),
	isValidPrivate: (bytes: Uint8Array) => secp256k1.utils.isValidSecretKey(bytes),
	addHexPrefix: (hex: string) => (hex.startsWith("0x") ? hex : "0x" + hex),
};
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

// Exported so the keystore format can be round-tripped in a test: `generate_keystore` below wraps
// this in a Blob for the browser, which Node cannot read back, and the write path otherwise has no
// test at all — the gap that would make a library migration of it undetectable.
export async function keystore_json(pkey: string, password: string): Promise<Record<string, any> | null> {
	const Wallet = await _Wallet;

	if (!password || password === '') { return null; }

	if (!pkey.startsWith("0x")) { pkey = "0x" + pkey; }
	let buf: Uint8Array;
	try {
		buf = await eth_util.toBuffer(pkey);
	} catch (err) {
		console.log(err);
		return null;
	}

	const wallet = Wallet.fromPrivateKey(buf);
	return await wallet.toV3(password, {
		kdf: 'scrypt',
		n: 131072
	});
}

export async function generate_keystore(pkey: string, password: string) {
	const res = await keystore_json(pkey, password);
	if (!res) { return null; }

	const Wallet = await _Wallet;
	const wallet = Wallet.fromPrivateKey(await eth_util.toBuffer(pkey));

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

	// Uncompressed (65-byte, `04`-prefixed) public key, bare hex — the shape
	// `get_account_from_public_key` expects. Noble's output is byte-identical to the previous
	// library's `key.getPublic('hex')`; the devnet's own funded address is the proof (test:unit
	// pins the derived accounts, and devnet.sh's constant matches).
	const pub_key = hex_of(secp256k1.getPublicKey(to_buffer(private_key), false));
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
	const checksum_calc = (await blakejs.blake2bHex(payload_bytes, undefined, 32)).slice(0, 8);

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
	const private_key = hex_of(secp256k1.utils.randomSecretKey());
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
