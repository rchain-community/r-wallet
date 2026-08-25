import { useState, ChangeEvent, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Components from 'components';
import { useLayout } from "Context"
import * as u from 'utils';

export function AccessKeystore() {
  const navigate = useNavigate();
  const layout = useLayout();
  const password = u.useWritableWithToggle("", false);
  const [keystore_file, set_keystore_file] = useState<File|null>(null);
  const [unlocking, set_unlocking] = useState<u.OPERATION>(u.OPERATION.INITIAL);

  function set_file(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files || event.target.files.length === 0) {
      set_keystore_file(null);
      return;
    }

    let file = event.target.files.item(0);
    set_keystore_file(file);
  }

  async function unlock() {
    if (!keystore_file) { return; }

    set_unlocking(u.OPERATION.PENDING);
    // Wait a bit before we start loading, so that the
    // spinner shows up.
    await new Promise(r => setTimeout(r, 16));

    let ks: Record<string, any>;
    try {
      ks = await u.read_json_file(keystore_file) as Record<string, any>;
    } catch {
      layout.push_notif({
        group_id: "access-keystore-error",
        content: u.notif.info("Error", "Failed to read keystore. File is possibly not formatted correctly.")
      });
      set_unlocking(u.OPERATION.INITIAL);
      return;
    }

    if (!ks) {
      set_unlocking(u.OPERATION.INITIAL);
      layout.push_notif({
        group_id: "access-keystore-error",
        content: u.notif.info("Error", "Failed to read keystore. File is possibly formatted incorrectly.")
      });
      return;
    }

    let priv_wallet = await u.bc.get_account_from_keystore(ks, password.value);
    if (priv_wallet == null) {
      layout.push_notif({
        group_id: "access-keystore-error",
        content: u.notif.info("Error", "Failed to read keystore. Check your password.")
      });
      set_unlocking(u.OPERATION.INITIAL);
      return;
    }

    set_unlocking(u.OPERATION.DONE);
    let w = u.g.create_user("My Wallet", "", priv_wallet);
    u.g.set_active_user(w);
    navigate("/balance");
  }

  function handle_key(ev: KeyboardEvent) {
      if (ev.nativeEvent.code === "Enter") {
          unlock();
      }
  }

  return (
    <Components.Strip bg=""
      className="w-fit max-w-96 sm:mt-16"
      onKeyUp={handle_key}
    >
      <h2 className="mb-8">Access Your Wallet</h2>
      <p>
        Use a keystore file to access your wallet.
      </p>

      <label title="KEYSTORE FILE">
        <input placeholder="KEYSTORE FILE"
          type="file" onChange={set_file}
        />
      </label>

      <label title="PASSWORD">
        <input placeholder="PASSWORD"
          value={password.value}
          onChange={password.write}
          type={password.toggle_value ? "text" : "password"}
        />
            <Components.ToggleButton
                val={password.toggle_value}
                setval={password.set_toggle}
            />
        </label>

        <div className="flex justify-between mt-8">
            <Components.Button
                className="w-min self-center"
                onClick={() => navigate("/")}
            >
                BACK
            </Components.Button>

            <Components.Spinner op={unlocking}
              children_initial={
                <Components.Button
                    className="w-min self-center"
                    disabled={!keystore_file || password.value.length === 0}
                    onClick={unlock}
                >
                    UNLOCK
                </Components.Button>
              }
            >
            </Components.Spinner>
        </div>
    </Components.Strip>
  );
}
