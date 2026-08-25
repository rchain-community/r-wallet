import { useState, ChangeEvent } from 'react';
import * as u from 'utils';
import { useNavigate } from 'react-router-dom';
import { useLayout } from 'Context';
import * as Components from 'components';

function normalize_mnemonic(mnemonic: string) {
  let words = mnemonic.toLowerCase().match(/\w+/g);
  if (!words) { return ""; }
  return words.join(" ");
}

const get_account_from_mnemonic = u.memoize(u.bc.get_account_from_mnemonic);

export function AccessMnemonic() {
  const navigate = useNavigate();
  const layout = useLayout();
  const [wallet, set_wallet] = useState<u.PrivateWallet | null>(null);

  async function handle_change(event: ChangeEvent<HTMLTextAreaElement>) {
    set_wallet(null);

    let mnemo = normalize_mnemonic(event.target.value);
    let is_valid = u.bc.is_valid_mnemonic(mnemo);
    if (!is_valid) { return; }

    set_wallet(await get_account_from_mnemonic(mnemo));
  }

  function finish() {
    if (wallet == null) {
      layout.push_notif({
        group_id: "access-mnemonic-error",
        content: u.notif.info("Error", "Couldn't get wallet from mnemonic!")
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
        Use a mnemonic phrase to access your wallet.
      </p>

      <label>
        <textarea placeholder="MNEMONIC PHRASE"
          onChange={handle_change}
          rows={4} cols={35}>
        </textarea>
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
