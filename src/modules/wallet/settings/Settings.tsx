// import './Settings.scss';
import { useState } from 'react';
import { useLayout } from 'Context';
import { PassConfirmModal } from 'components';
import * as u from 'utils';
import * as Components from 'components';

export function Settings() {
  const layout = useLayout();
  const [keystore_op, set_keystore_op] = useState(u.OPERATION.INITIAL);

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

  return (
    <Components.Strip bg="">
      <h2 className="sm:mt-16">Settings</h2>
      <div className="Body Settings">
        <AccessMethods />
      </div>
    </Components.Strip>
  );
}
