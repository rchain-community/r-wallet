import type { KeyboardEvent } from "react";
import { ToggleButton } from 'components';
import { useNavigate } from 'react-router-dom';
import { useLayout } from "Context";
import * as u from "utils";
import * as Components from "components";

const g = u.g;

export function AccessLocal() {
    const navigate = useNavigate();
    const layout = useLayout();
    const name = u.useWritable("");
    const password = u.useWritableWithToggle("", false);

    function access() {
        if (!name.value) { return; }

        let user_index = g.wallet_index(g.user_list, name.value);
        if (user_index === -1) {
            layout.push_notif({
                group_id: "access-local-error",
                content: u.notif.info("Error", `No wallet named "${name.value}" exists!`)
            });
            return;
        }

        let user = g.user_list[user_index];

        if (user.password !== password.value) {
            layout.push_notif({
                group_id: "access-local-error",
                content: u.notif.info("Error", "Incorrect password!")
            });
            return;
        }

        g.set_active_user(user);
        navigate("/balance");
    }

    function handle_key(ev: KeyboardEvent) {
        if (ev.nativeEvent.code === "Enter") {
            access();
        }
    }

    return (
        <Components.Strip bg=""
            className="w-fit max-w-96 sm:mt-16"
            onKeyUp={handle_key}
        >
            <h2 className="mb-8">Access Locally Stored Wallet</h2>
            <p>
                Unlock a wallet that you have previously locally stored in your browser
            </p>

            <label title="WALLET NAME">
                <input placeholder="WALLET NAME"
                    value={name.value}
                    onChange={name.write} />
            </label>

            <label title="PASSWORD">
                <input placeholder="PASSWORD"
                    value={password.value}
                    onChange={password.write}
                    type={password.toggle_value ? "text" : "password"}
                />
                <ToggleButton
                    val={password.toggle_value}
                    setval={password.set_toggle}
                />
            </label>

            <div className="flex justify-between mt-10">
                <Components.Button
                    className="w-min self-center"
                    onClick={() => navigate("/")}
                >
                    BACK
                </Components.Button>

                <Components.Button
                    className="w-min self-center"
                    disabled={!(name.value && password.value)}
                    onClick={access}
                >
                    UNLOCK
                </Components.Button>
            </div>
        </Components.Strip>
    )
}
