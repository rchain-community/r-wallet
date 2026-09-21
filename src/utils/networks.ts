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
		group: "RChain Testnet",
		network: "rhobot",
		name: "Rhobot Testnet Node",
		url: "https://rnodeapi.rhobot.net"
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
