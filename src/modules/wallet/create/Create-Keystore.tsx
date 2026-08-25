import { useState } from 'react';
import * as u from 'utils';
import { useNavigate } from 'react-router-dom';
import * as Components from 'components';
import { useLayout } from 'Context';

export function CreateKeystore() {
  const navigate = useNavigate();
  const layout = useLayout();
  const [keystore_op, set_keystore_op] = useState(u.OPERATION.INITIAL);
  const [ks_blob, set_ks_blob] = useState<u.Unbox<ReturnType<typeof u.bc.create_keystore>> | null>(null);
  const [wallet, set_wallet] = useState<u.PrivateWallet | null>(null);

  function download_ks() {
    if (ks_blob) {
      u.download_blob(ks_blob.blobUrl, ks_blob.name);
    }
  }

  async function generate_keystore(pass: string) {
    set_keystore_op(u.OPERATION.PENDING);
    let ret;

    let wallet = await u.bc.create_account();
    if (!wallet) {
      layout.push_notif({
        group_id: "create-keystore-error",
        content: u.notif.info("Error", "Failed to generate keystore.")
      });
      set_keystore_op(u.OPERATION.INITIAL);
      return
    }
    set_wallet(wallet);

    try {
      ret = await u.bc.generate_keystore(wallet.privKey,  pass);
    } catch(err) {
      ret = null;
      console.error(err);
    }

    if (ret) {
      set_ks_blob(ret);
      u.download_blob(ret.blobUrl, ret.name);
      set_keystore_op(u.OPERATION.DONE);
    } else {
      layout.push_notif({
        group_id: "create-keystore-error",
        content: u.notif.info("Error", "Failed to generate keystore.")
      });
      set_keystore_op(u.OPERATION.INITIAL);
    }
  }

  function get_keystore() {
    layout.push_modal({
      component: Components.PassConfirmModal,
      props: {
        title: "Keystore password",
        text: "Set a password for your keystore file",
        button: "Confirm",
        onFinish: (val) => {
          if (!val) { return; }
          generate_keystore(val);
        }
      }
    });
  }

  function finish() {
    if (!wallet) { return; }
    let user = u.g.create_user("My Wallet", "", wallet);
    u.g.set_active_user(user);
    navigate("/balance");
  }

  return (
    <Components.Strip bg="" className="sm:mt-16">
      <h2 className="mb-8">Create a New Wallet</h2>

      <p className="max-w-96">
        A keystore file is an encrypted, password protected
        version of your private key. If you have your keystore
        file handy, you can use it to access your wallet from
        anywhere.
      </p>

      <div className="flex justify-between mt-8 gap-2">
        <Components.Spinner
          op={keystore_op}
          className="mx-auto"
          children_initial={<>
            <Components.Button onClick={() => navigate("/")}>
              BACK
            </Components.Button>

            <Components.Button className="w-fit" onClick={get_keystore}>
              GENERATE KEYSTORE
            </Components.Button></>}

          children_done={
            <div className="flex flex-col gap-4 items-center mx-auto">
              <Components.Button className="w-fit" onClick={download_ks}>
                REDOWNLOAD
              </Components.Button>
              <Components.Button className="w-fit" onClick={finish}>
                CONTINUE TO YOUR WALLET
              </Components.Button>
            </div>
          }
          />
      </div>

    </Components.Strip>
  );
}
