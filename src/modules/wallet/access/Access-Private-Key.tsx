import { useState, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayout } from 'Context';
import * as Components from 'components';
import * as u from 'utils';

export function AccessPrivateKey() {
  const navigate = useNavigate();
  const layout = useLayout();
  const [wallet, set_wallet] = useState<u.PrivateWallet | null>(null);
  const [toggle, set_toggle] = useState(false);

  async function handle_change(event: ChangeEvent<HTMLInputElement>) {
    let val = event.target.value;
    set_wallet(null);

    if (!val.startsWith("0x")) {
      val = "0x" + val;
    }

    let valid_pkey = await u.bc.is_valid_private_key(val);
    if (!valid_pkey) { return; }

    set_wallet(await u.bc.get_account_from_private_key(valid_pkey));
  }

  function finish() {
    if (!wallet) {
      layout.push_notif({
        group_id: "access-pkey-error",
        content: u.notif.info("Error", "Failed to access wallet. Private key might be invalid.")
      });

      return;
    }

    let w = u.g.create_user("My Wallet", "", wallet);
    u.g.set_active_user(w);

    navigate("/balance");
  }

  return (
    <Components.Strip bg="" className="sm:mt-16">
      <h2 className="mb-8">Access Your Wallet</h2>

      <p>
        Use a private key to access your wallet.
      </p>

      <label title="PRIVATE KEY">
        <input placeholder="PRIVATE KEY"
          type={toggle ? "text" : "password"}
          onChange={handle_change}
        />

        <Components.ToggleButton
            val={toggle}
            setval={set_toggle}
        />
      </label>

      <div className="flex justify-between mt-8">
        <Components.Button
          className="w-fit"
          onClick={() => navigate("/")}
        >
          BACK
        </Components.Button>

        <Components.Button
          className="w-fit"
          disabled={!wallet}
          onClick={finish}
        >
          CONTINUE
        </Components.Button>
      </div>
    </Components.Strip>
  )
}
