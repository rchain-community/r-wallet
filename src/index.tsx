import './styles/index.scss';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { g, nw, tx, useLocalStorage } from 'utils';
import * as Components from 'components';
import { LayoutContext, NodeContext, Notif } from "./Context";
import type { Modal } from "components";

declare global {
	function get_preferred_theme(): "light"|"dark";
	function set_theme(
		theme: "light"|"dark"|null,
		write_local_storage: boolean
	): void;

	function set_layout(layout_classes: string): void;
};

g.restore_user_list();
tx.restore_tx_list();

let notif_id = 0;

export function App() {
	let [node, set_node] = useState<nw.Named_Node>(g.built_in_nodes[0]);
	let [custom_nodes, set_custom_nodes] = useLocalStorage("custom-nodes", []);

	let [modal_stack, set_modal_stack] = useState<Modal<any>[]>([]);
	let [notif_stack, set_notif_stack] = useState<Notif[]>([]);

	let initial_data = {
		node, set_node(val) { set_node(val) },

		custom_nodes,
		set_custom_node(
			old_name: string|null,
			new_node: nw.Named_Node
		) {
			let idx = custom_nodes.findIndex(n => n.name == old_name);

			if (old_name && idx >= 0) {
				set_custom_nodes((old) => {
					old.splice(idx, 1, new_node);
					return [...old];
				});

				if (old_name == node.name) {
					set_node(new_node);
				}
			} else {
				set_custom_nodes((old) => {
					old.push(new_node);
					return [...old];
				});
			}
		},

		remove_custom_node(name: string) {
			let idx = custom_nodes.findIndex(n => n.name == name);
			if (idx >= 0) {
				set_custom_nodes((old) => {
					old.splice(idx, 1);
					return [...old];
				});

				if (node.name == name) {
					set_node(g.built_in_nodes[0]);
				}
			}
		},

		get_validator_url() { return nw.get_node_url(node); },

		get_readonly_url() {
			if (node.read_only) {
				return nw.get_node_url(node.read_only);
			}
			return nw.get_node_url(node);
		},

		get_admin_url() {
			if (node.admin) {
				return nw.get_node_url(node.admin);
			}
			return nw.get_node_url({
				...node,
				port: 40405
			});
		}

	} satisfies NodeContext;

	let initial_layout = {
		modal_stack,
		push_modal(modal: Modal<any>) {
			modal_stack.push(modal);
			set_modal_stack([...modal_stack]);
		},
		pop_modal() {
			let modal = modal_stack.pop();
			if (modal) {
				set_modal_stack([...modal_stack]);
			}
		},

		notif_stack,
		push_notif(notif: Notif) {
			notif.__id = ++notif_id;

			if (notif.group_id) {
				notif_stack = notif_stack.filter(n => n.group_id !== notif.group_id);
			}

			notif_stack.push(notif);
			set_notif_stack([...notif_stack]);
		},
		remove_notif(notif: Notif) {
			set_notif_stack(notif_stack.filter(n=>n.__id !== notif.__id));
		}

	} satisfies LayoutContext;

	return (<>
		<NodeContext.Provider value={initial_data}>
			<LayoutContext.Provider value={initial_layout}>
				<HashRouter>
					<Components.Routes />
				</HashRouter>
				<Components.ModalHost />
				<Components.NotifHost />
			</LayoutContext.Provider>
		</NodeContext.Provider>
	</>);
}

const domNode = document.getElementById("root")!;
const root = createRoot(domNode);
root.render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);

