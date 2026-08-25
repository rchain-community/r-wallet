// import './Settings.scss';
import { useState } from 'react';
import { useLayout } from 'Context';
import { WalletLockModal, PassConfirmModal } from 'components';
import * as u from 'utils';
import * as Components from 'components';

export function Settings() {
  const layout = useLayout();
  const [keystore_op, set_keystore_op] = useState(u.OPERATION.INITIAL);
  const [is_local, set_is_local] = useState(!!u.g.user?.password);

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

  async function save_wallet() {
    if (u.g.user) {
      layout.push_modal({
        component: WalletLockModal,
        props: {
          title: "Save your wallet locally",
          text: "Give your wallet a descriptive name and a password",
          button: "Save",
          onFinish: (val) => {
            if (!val) { return; }
            if (!user) { return; }
            user.name = val.name;
            user.password = val.password;
            u.g.add_user(user);
            set_is_local(true);
          }
        }
      });
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

      <h3>Locally stored wallet</h3>
      <p>
        Storing your wallet locally, in your browser,
        allows you to quickly access it with a password.
        You will be able to access your locally stored
        wallets as long as you do not clear your browser
        data.
      </p>
      <div className="mt-2 mb-16 text-center">
        {is_local ?
          <p className="Alt AccessDescription">
            This wallet is already stored locally!
          </p>
        :
          <Components.Button onClick={save_wallet}>
            STORE MY WALLET LOCALLY
          </Components.Button>
        }
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
