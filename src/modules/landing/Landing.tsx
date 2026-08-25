import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Components from 'components';
import { useLayout } from 'Context';
import { icon } from 'assets';
import * as u from 'utils';
import { BRAND } from "../../config/branding";

export function Landing() {
    let navigate = useNavigate();
    let layout = useLayout();

    let [has_metamask, set_has_metamask] = useState(false);
    let [waiting, set_waiting] = useState(false);

    async function detect_eth() {
        const {ethDetected} = await import("../../../vendored/@tgrospic/rnode-http-js/src");
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

            </div>

        </Components.Strip>
    );
}
