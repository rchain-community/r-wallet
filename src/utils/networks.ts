// shortname: nw

import * as u from './utils';

export interface Node {
	url: string;
	port?: number;
};

export interface Named_Node extends Node {
	name: string;
	group?: string;
	/** Key into the governance master-URI table (src/config/master-uri.ts). */
	network?: string;
	read_only?: Node;
	admin?: Node;
	editable?: boolean;
};

function local_node(n: number): Named_Node {
	return {
		group: "local",
		network: "localhost",
		name: `localhost-${n}`,
		url: "http://localhost",
		port: 40403 + n*10,
	};
}

export const local_nodes = u.range(0, 5).map(local_node);

export const r_nodes: Named_Node[] = [
	{
		// A single-node dev chain that proposes on every deploy — the place to
		// learn rholang and try contracts. It is NOT the testnet; the two are
		// different chains with different genesis.
		group: "RChain",
		network: "rhobot",
		name: "Rholang Playground",
		url: "https://rnodeapi.rhobot.net"
	},
	{
		// The real testnet: two bonded validators, and deliberately idle — a
		// block appears when a deploy arrives, not on a timer.
		group: "RChain",
		network: "testnet",
		name: "Rhobot Testnet",
		url: "https://testnet.rhobot.net"
	}
];

export function custom_node(name: string, url: string, port?: number): Named_Node {
	return {
		group: "Custom",
		name, url, port,
		editable: true
	};
}

export function get_node_url(node: Node) {
	if (node.port) {
		return `${node.url}:${node.port}`;
	} else {
		return node.url;
	}
}

export function get_readonly_url(node: Named_Node) {
	if (node.read_only) return get_node_url(node.read_only);
	return get_node_url(node);
}

export function get_admin_url(node: Named_Node) {
	if (node.admin) return get_node_url(node.admin);
	return get_node_url({...node, port: 40405});
}
