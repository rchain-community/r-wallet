// Quantum key hygiene on the dashboard: whether the active account's public key is revealed, a
// warning when a revealed account holds more than the threshold, and a sweep of the whole balance to
// a fresh, never-used address. The logic lives in src/utils/exposure.ts and `rnode.sweep`; this is
// the UI. Background: rchain-rust docs/src/contributor/post-quantum-plan.md §16.1.

import { useEffect, useState } from "react";
import { useLayout, useNodes } from "Context";
import * as u from "utils";
import { rhoExprToJson } from "api";
import { BRAND } from "../../config/branding";
import { Button } from "../buttons/Button";
import { Spinner } from "../spinner/Spinner";
import { PassConfirmModal } from "../modals/Pass-Confirm-Modal";

interface KeyExposureProps {
    /** The active account's balance in drops, or null while unknown. */
    balance: number | null;
    /** Called after a successful sweep has made the fresh account the active one. */
    on_swept: () => void;
}

export function KeyExposure(props: KeyExposureProps) {
    const node_context = useNodes();
    const layout = useLayout();
    const [exposure, set_exposure] = useState<u.exposure.Exposure | null>(null);
    const [check_op, set_check_op] = useState(u.OPERATION.INITIAL);
    const [sweep_op, set_sweep_op] = useState(u.OPERATION.INITIAL);

    const user = u.g.user;
    const pub_key = user && u.wallet_is_private(user) ? user.pubKey : null;

    async function check() {
        if (!pub_key) return;
        set_check_op(u.OPERATION.PENDING);
        set_exposure(await u.g.check_exposure(node_context, pub_key));
        set_check_op(u.OPERATION.DONE);
    }

    useEffect(() => { check(); }, [node_context.node, pub_key]);

    // A MetaMask account has no key here to reveal or sweep with.
    if (!user || !pub_key || !u.wallet_is_private(user)) return <></>;
    const from = user as u.UserWallet;

    const threshold = u.exposure.get_threshold_rev();
    const warn = exposure !== null && u.exposure.should_warn(exposure, props.balance, threshold);

    function confirm_sweep() {
        layout.push_modal({
            component: PassConfirmModal,
            props: {
                title: "Sweep to a fresh address",
                text: "A new address is generated and its keystore downloaded before anything is sent. "
                    + "Set a password for that keystore file.",
                button: "Generate and sweep",
                onFinish: (val) => {
                    if (!val) return;
                    sweep(val);
                }
            }
        });
    }

    function notify(title: string, text: string) {
        layout.push_notif({ group_id: "sweep", content: u.notif.info(title, text) });
    }

    async function sweep(password: string) {
        set_sweep_op(u.OPERATION.PENDING);
        try {
            const fresh = await u.bc.create_account();
            if (!fresh) {
                notify("Sweep not sent", "Failed to generate a fresh address.");
                return;
            }
            // Back up the fresh key *before* moving anything to it: once the deploy runs, the
            // balance lives behind this key and nowhere else.
            const keystore = await u.bc.generate_keystore(fresh.privKey, password);
            if (!keystore) {
                notify("Sweep not sent", "Failed to generate the keystore for the fresh address.");
                return;
            }
            await u.download_blob(keystore.blobUrl, keystore.name);

            const res = await u.g.sweep(node_context, from, fresh.revAddr);
            if (res.error || !res.expr) {
                notify(
                    "Sweep did not complete",
                    `${res.error ?? "No result."}\nThe keystore for ${fresh.revAddr} was downloaded; `
                    + "keep it, in case the deploy is still included later."
                );
                return;
            }
            const reply = rhoExprToJson(res.expr[0]);
            if (!Array.isArray(reply) || reply[0] !== true) {
                notify("Sweep refused", `${Array.isArray(reply) ? String(reply[1]) : JSON.stringify(reply)}`);
                return;
            }

            u.g.set_active_user(u.g.create_user(from.name, password, fresh));
            notify(
                "Swept",
                `${Number(reply[1]) / u.exposure.DROPS_PER_REV} ${BRAND.ticker} moved to ${fresh.revAddr}, now the active account. `
                + "Its key has not signed anything yet; use a separate account for everyday deploys to keep it that way."
            );
            props.on_swept();
        } finally {
            set_sweep_op(u.OPERATION.INITIAL);
        }
    }

    return <div className="mt-4 flex flex-col gap-2 max-w-96">
        <h3>Quantum exposure</h3>
        <Spinner
            op={check_op}
            className="w-6 h-6"
            children_done={<p className="text-sm">{exposure ? u.exposure.describe_exposure(exposure) : ""}</p>}
        />
        {exposure?.state === "indexing" && (
            <Button className="w-fit" onClick={check}>CHECK AGAIN</Button>
        )}
        {layout.help_mode && (
            <p className="text-sm opacity-70">
                An address is a hash of its public key, so receiving {BRAND.ticker} reveals nothing. Signing a deploy
                publishes the key, and a large enough quantum computer could then derive the private key.
                Keep value at an address that has never signed, and leave a revealed one by sweeping it.
            </p>
        )}
        {warn && (
            <p className="warning">
                This account's public key is public and it holds more than {threshold} {BRAND.ticker}. Move the
                balance to a fresh address. The threshold is set in Settings.
            </p>
        )}
        <Spinner
            op={sweep_op}
            className="w-8 h-8"
            children_initial={
                <Button
                    className="w-fit"
                    onClick={confirm_sweep}
                    disabled={!props.balance}
                >
                    SWEEP TO FRESH ADDRESS
                </Button>
            }
        />
        {layout.help_mode && (
            <p className="text-sm opacity-70">
                Moves the whole balance to a newly generated address in one deploy. The deploy itself
                reveals this account's key, and the unused phlo is refunded here afterwards, so a little
                dust stays behind.
            </p>
        )}
    </div>;
}
