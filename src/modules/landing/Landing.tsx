import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Components from 'components';
import { useLayout } from 'Context';
import { Icon, icon } from 'assets';
import * as u from 'utils';
import { BRAND } from "../../config/branding";
import {
    PLAYGROUND_ACCOUNTS,
    PLAYGROUND_NETWORK,
    pick_random_account,
    type PlaygroundAccount,
} from "../../config/playground";

export function Landing() {
    let navigate = useNavigate();
    let layout = useLayout();

    let [has_metamask, set_has_metamask] = useState(false);
    let [waiting, set_waiting] = useState(false);
    let [picking, set_picking] = useState(false);

    // Testnet wallet card: the loaded account, and whether its key is revealed.
    let [loaded, set_loaded] = useState<PlaygroundAccount | null>(null);
    let [revealed, set_revealed] = useState(false);

    async function detect_eth() {
        const {ethDetected} = await import("../../utils/metamask");
        set_has_metamask(ethDetected);

        if (ethDetected) {
            // metamask_access();
        }
    }

    async function metamask_access() {
        set_waiting(true);

        let wallet = await u.bc.get_account_from_metamask();
        if (!wallet) {
            layout.push_notif({
                group_id: "access-metamask-error",
                content: u.notif.info("Error", "Failed to access MetaMask wallet.")
            });
            set_waiting(false);
            return
        }

        let user = u.g.create_user_metamask(wallet);
        u.g.set_active_user(user);
        set_waiting(false);
        navigate("/balance");
    }

    useEffect(() => { detect_eth(); }, []);

    let card_metamask = (
        <Components.Card
            icon={icon("metamask")}
            icon_color=""
            title="METAMASK"
            bg={"bg-metamask"} fg={"text-base-50"}
            shadow={"shadow-metamask"}
        >
            <p>Access your wallet via MetaMask</p>
            <p className="mb-auto italic text-center">
                {!has_metamask && "The MetaMask extension is not installed!"}
            </p>

            <div className="flex gap-2 justify-end">
                <Components.Button
                    disabled={waiting || !has_metamask}
                    onClick={metamask_access}
                    className="bg-base-50 text-base-950"
                >
                    ACCESS
                </Components.Button>
            </div>
        </Components.Card>
    );

    let card_local: JSX.Element|null = null;
    if (u.g.user_list.length > 0) {
        card_local = (
            <Components.Card
                icon={icon("wallet-small")}
                title="LOCAL WALLET"
                bg={"bg-primary-700"} fg={"text-base-50"}
                shadow={"shadow-primary-700"}
            >
                <p className="mb-auto">Access your locally stored wallet</p>

                <div className="flex gap-2 justify-end">
                    <Components.Button className="bg-base-50 text-base-950" onClick={() => navigate("/access/local")}>
                        ACCESS
                    </Components.Button>
                </div>
            </Components.Card>
        );
    }

    // Load a pre-funded testnet wallet, excluding whichever is already active so
    // pressing the button again lands somewhere new.
    function load_wallet() {
        let account = pick_random_account(u.g.user?.revAddr);
        if (!account) { return; }

        set_loaded(account);
        set_revealed(false);
    }

    async function use_wallet() {
        if (!loaded) { return; }

        set_picking(true);
        await u.playground.activate_account(loaded, layout, navigate);
        set_picking(false);
    }

    function copy_key() {
        if (loaded) {
            navigator.clipboard.writeText(loaded.privKey);
        }
    }

    let card_playground: JSX.Element|null = null;
    if (PLAYGROUND_ACCOUNTS.length > 0) {
        card_playground = (
            <Components.Card
                icon={icon("wallet-small")}
                icon_color={"icon-primary-100"}
                title="TESTNET WALLET"
                bg={"bg-primary-600"} fg={"text-base-50"}
                shadow={"shadow-primary-600"}
            >
                {
                    loaded === null
                    ? <>
                        <p className="mb-auto">
                            Load one of {PLAYGROUND_ACCOUNTS.length} pre-funded {PLAYGROUND_NETWORK} wallets.
                        </p>

                        <div className="flex justify-end">
                            <Components.Button
                                className="bg-base-50 text-base-950"
                                onClick={load_wallet}
                            >
                                LOAD WALLET
                            </Components.Button>
                        </div>
                    </>
                    : <>
                        <div className="flex flex-col">
                            <span className="text-xs font-bold">{loaded.name}</span>
                            <span className="font-mono text-xs break-all opacity-90">{loaded.revAddr}</span>
                        </div>

                        <label title="PRIVATE KEY" className="items-center">
                            <input
                                className="font-mono text-xs"
                                type={revealed ? "text" : "password"}
                                value={loaded.privKey}
                                readOnly
                            />

                            <Components.ToggleButton val={revealed} setval={set_revealed} />

                            <Components.Button
                                className="p-2 rounded-full"
                                title="COPY PRIVATE KEY"
                                onClick={copy_key}
                            >
                                <Icon name="copy" color={"icon-base-50"} className="w-4 h-4" />
                            </Components.Button>
                        </label>

                        <div className="flex flex-wrap gap-2 justify-between">
                            <Components.Button
                                className="bg-base-50 text-base-950"
                                disabled={picking}
                                onClick={load_wallet}
                            >
                                LOAD ANOTHER
                            </Components.Button>

                            <Components.Button
                                className="bg-base-50 text-base-950"
                                disabled={picking}
                                onClick={use_wallet}
                            >
                                { picking ? "CONNECTING…" : "USE WALLET" }
                            </Components.Button>
                        </div>
                    </>
                }
            </Components.Card>
        );
    }

    return (
        <Components.Strip bg="" className="sm:mt-16 max-w-fit">
            <h2 className="text-center mb-8">Access or create your {BRAND.name}</h2>

            <div className="flex flex-row flex-wrap gap-8 justify-center items-center">
                { card_local }
                { card_metamask }

                <Components.Card
                    icon={icon("keystore-small")}
                    title="KEYSTORE FILE"
                    bg={"bg-secondary-500"} fg={"text-base-50"}
                    shadow={"shadow-secondary-500"}
                >
                    <p className="mb-auto">A keystore file is an encrypted version of your private key</p>

                    <div className="flex gap-2 justify-between">
                        <Components.Button className="bg-base-50 text-base-950" onClick={() => navigate("/create/keystore")}>
                            CREATE
                        </Components.Button>

                        <Components.Button className="bg-base-50 text-base-950" onClick={() => navigate("/access/keystore")}>
                            ACCESS
                        </Components.Button>
                    </div>
                </Components.Card>

                <Components.Card
                    icon={icon("bubble-small")}
                    icon_color={"icon-primary-300"}
                    title="MNEMONIC PHRASE"
                    bg={"bg-primary-300"} fg={"text-base-50"}
                    shadow={"shadow-primary-300"}
                >
                    <p className="mb-auto">A mnemonic phrase is a series of words that decode to your private key</p>

                    <div className="flex gap-2 justify-between">
                        <Components.Button className="bg-base-50 text-base-950" onClick={() => navigate("/create/mnemonic")}>
                            CREATE
                        </Components.Button>

                        <Components.Button className="bg-base-50 text-base-950" onClick={() => navigate("/access/mnemonic")}>
                            ACCESS
                        </Components.Button>
                    </div>
                </Components.Card>

                <Components.Card
                    icon={icon("key-small")}
                    icon_color={"icon-primary-800"}
                    title="PRIVATE KEY"
                    bg={"bg-primary-800"} fg={"text-base-50"}
                    shadow={"shadow-primary-800"}
                >
                    <p className="mb-auto">Access your wallet directly via your private key</p>

                    <div className="flex gap-2 justify-end">
                        <Components.Button className="bg-base-50 text-base-950" onClick={() => navigate("/access/private-key")}>
                            ACCESS
                        </Components.Button>
                    </div>
                </Components.Card>

                { card_playground }

            </div>

        </Components.Strip>
    );
}
