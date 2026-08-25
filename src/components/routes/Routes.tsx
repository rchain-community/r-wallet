import { CSSTransition, TransitionGroup } from "react-transition-group";
import { useLocation, useRoutes, Navigate } from "react-router-dom";
import * as Components from "components";
import * as Modules from "modules";

const RoutesArray = [
	{ path: "*", element: <Navigate to="/" replace /> },
	{ path: "/", element: <Modules.Deploy /> },
	{ path: "/access", element: <Modules.Landing /> },

	{ path: "/create/mnemonic", element: <Modules.CreateMnemonic/> },
	{ path: "/create/keystore", element: <Modules.CreateKeystore/> },

	{ path: "/access/mnemonic", element: <Modules.AccessMnemonic/> },
	{ path: "/access/keystore", element: <Modules.AccessKeystore/> },
	{ path: "/access/private-key", element: <Modules.AccessPrivateKey/> },
	{ path: "/access/local", element: <Modules.AccessLocal/> },

	{ path: "/balance", element: <Modules.Dashboard/> },
	{ path: "/transfer", element: <Modules.Transfer/> },
	{ path: "/settings", element: <Modules.Settings/> },
];

export function Routes() {
	const location = useLocation();
	let routes_element = useRoutes(RoutesArray, location);

	return <>
		<Components.Navigation />
		<TransitionGroup className="relative">
			<CSSTransition
				key={location.key}
				classNames="fade"
				timeout={150}
			>
				{routes_element}
			</CSSTransition>
		</TransitionGroup>
	</>;
}
