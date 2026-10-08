// import './Settings.scss';
import { useState } from 'react';
import { useLayout } from 'Context';
import { PassConfirmModal } from 'components';
import * as u from 'utils';
import * as Components from 'components';
import { BRAND } from '../../../config/branding';

export function Settings() {
  const layout = useLayout();
  const [keystore_op, set_keystore_op] = useState(u.OPERATION.INITIAL);
  const [threshold, set_threshold] = useState(String(u.exposure.get_threshold_rev()));

  let navigate = u.useNavigateIf(!u.g.user, "/access");
  u.useNavigateIf(u.wallet_is_metamask(u.g.user), "/balance", navigate);

  let user = u.g.user as u.UserWallet;

  function get_keystore() {
    if (user) {
      layout.push_modal({
        component: PassConfirmModal,
        props: {
          title: "Keystore password",
          text: "Set a password for your keystore file",
          button: "Confirm",
          onFinish: (val) => {
            if (!val) { return; }
            if (!u.g.user) { return; }
            generate_keystore(val);
          }
        }
      });
    }
  }

  async function generate_keystore(pass: string) {
    if (user) {
      set_keystore_op(u.OPERATION.PENDING);
      let ret;

      try {
        ret = await u.bc.generate_keystore(user.privKey, pass);
      } catch {
        ret = null;
      }

      if (ret) {
        u.download_blob(ret.blobUrl, ret.name);
      }

      set_keystore_op(u.OPERATION.INITIAL);
    }
  }

  function AccessMethods() {
    return <>
      <h3>Keystore Access</h3>
      <p>
        A keystore file is an encrypted, password protected
        version of your private key. If you have your keystore
        file handy, you can use it to access your wallet from
        anywhere.
      </p>
      <div className="mt-2 mb-16 text-center">
        <Components.Spinner
          className="w-8 h-8 mx-auto"
          op={keystore_op}
          children_initial={
            <Components.Button onClick={get_keystore}>
              GENERATE KEYSTORE FILE
            </Components.Button>}
        />
      </div>
    </>;
  }

  function write_threshold(evt: React.ChangeEvent<HTMLInputElement>) {
    set_threshold(evt.target.value);
    const rev = Number(evt.target.value);
    if (evt.target.value !== "" && Number.isFinite(rev) && rev >= 0) {
      u.exposure.set_threshold_rev(rev);
    }
  }

  function QuantumExposure() {
    return <>
      <h3>Quantum exposure warning</h3>
      <p>
        Signing a deploy publishes an account's public key. The wallet warns when an account whose
        key is public holds more than this many {BRAND.ticker}, and offers to sweep it to a fresh
        address.
      </p>
      <label title={`THRESHOLD (${BRAND.ticker})`} className="mt-2 mb-16">
        <input
          type="number"
          min="0"
          step="any"
          value={threshold}
          onChange={write_threshold}
        />
      </label>
    </>;
  }

  return (
    <Components.Strip bg="">
      <h2 className="sm:mt-16">Settings</h2>
      <div className="Body Settings">
        <AccessMethods />
        {QuantumExposure()}
      </div>
    </Components.Strip>
  );
}
