import React, { type ReactNode, useContext } from "react";
import type { Modal, ModalBase } from "components";
import type { nw } from "utils";
import type { NodeCapabilities } from "api";

export interface Notif {
	content: ReactNode,
	group_id?: string | null,
	autoclose_seconds?: number | null,
	__id?: number,
};

export interface LayoutContext {
	modal_stack: Modal<any>[];
	push_modal<T extends ModalBase<any>>(data: Modal<T>): void;
	pop_modal(): void;

	notif_stack: Notif[];
	push_notif(data: Notif): void;
	remove_notif(data: Notif): void;

	help_mode: boolean;
	set_help_mode(v: boolean): void;
};

export interface NodeContext {
	custom_nodes: nw.Named_Node[];
	set_custom_node(old_name: string|null, node: nw.Named_Node): void;
	remove_custom_node(name: string): void;

	node: nw.Named_Node;
	set_node(n: nw.Named_Node): void;
	get_validator_url(): string;
	get_readonly_url(): string;
	get_admin_url(): string;
	capabilities: NodeCapabilities | null;
};

export const NodeContext = React.createContext({} as NodeContext);
export const LayoutContext = React.createContext({} as LayoutContext);

export function useLayout() {
	return useContext(LayoutContext);
}

export function useNodes() {
	return useContext(NodeContext);
}

