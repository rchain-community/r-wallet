import { useLocation, Link, Location } from 'react-router-dom';
import { g, wallet_is_metamask, useTheme } from 'utils';
import { Icon } from "assets";
import * as Components from "components";
import { BRAND } from "../../config/branding";

interface NavLinkProps {
  to: string;
  label: string;
  loc: Location;
  hide_when?: boolean;
}

function NavLink(props: NavLinkProps) {
  if (props.hide_when) return <></>;

  let is_active = props.loc.pathname == props.to;

  return <Link to={props.to} className={is_active ? "text-primary-300" : ""}>
    { props.label }
  </Link>
}

const WALLET_PATHS = ["/", "/balance", "/transfer", "/settings"];

function WalletLinks() {
  const location = useLocation();
  if (!WALLET_PATHS.includes(location.pathname)) return;

  return <div className="flex flex-wrap gap-4 justify-center px-4 leading-none">
    <NavLink to="/" label="EDITOR" loc={location} />
    <NavLink to="/balance" label="BALANCE" loc={location} />
    <NavLink to="/transfer" label="TRANSFER" loc={location} />
    <NavLink to="/settings" label="SETTINGS" loc={location} hide_when={wallet_is_metamask(g.user)} />
  </div>;
}

export function Navigation() {
  let theme = useTheme();

  let switcher_class = "absolute right-4 top-8 bg-transparent dark:bg-transparent p-2 rounded-full";
  let theme_switcher: JSX.Element;

  if (theme == "dark") {
    theme_switcher =
      <Components.Button
        className={switcher_class}
        onClick={() => set_theme("light", true)}
      >
        <Icon name="sun" color="icon-base-50" />
      </Components.Button>
    ;

  } else {
    theme_switcher =
      <Components.Button
        className={switcher_class}
        onClick={() => set_theme("dark", true)}
      >
        <Icon name="moon" color="icon-base-950" />
      </Components.Button>
    ;
  }

  return (
    <div className="flex flex-col gap-2 relative">
      {theme_switcher}
      <Link className="flex justify-center gap-4 mx-auto p-8" to="/">
          <img className="h-12" src={import.meta.env.BASE_URL+"logo.svg"} alt={BRAND.name} />
      </Link>
      <WalletLinks />
    </div>
  );
}
