import { useState, useEffect } from 'react';
import { useNodes, useLayout } from "Context";
import * as u from 'utils';
import * as Components from "components";
import { Icon } from "assets";
import { rhoExprToJson } from "../../../api/rho-json";
import { BRAND } from "../../../config/branding";

type PosStatus = u.Unbox<ReturnType<typeof u.g.pos_status>>;
type PosInfo = u.Unbox<ReturnType<typeof u.g.check_pos>>;
type Delegations = u.Unbox<ReturnType<typeof u.g.delegations>>;

const DROPS = 100000000;

function format_rev(drops: number) {
    return (drops / DROPS).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8
    });
}

function short_key(hex: string, head = 10, tail = 6) {
    if (hex.length <= head + tail + 1) { return hex; }
    return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

// The PoS screen: the epoch window, this account's stake and eligibility, and the operations the
// protocol actually supports — self-bond, staged unbond, and (for a trusted stakeholder) admitting
// another key. Bonding is permissioned and a key can only bond itself, so the UI surfaces those
// facts rather than hiding them (see docs/DEVELOPER.md and the node's validator-economics.md).
export function Staking() {
    const node_context = useNodes();
    const layout = useLayout();

    const [bond_op, set_bond_op] = useState(u.OPERATION.INITIAL);
    const [unbond_op, set_unbond_op] = useState(u.OPERATION.INITIAL);
    const [trust_op, set_trust_op] = useState(u.OPERATION.INITIAL);
    const [delegate_op, set_delegate_op] = useState(u.OPERATION.INITIAL);
    const [undelegate_op, set_undelegate_op] = useState(u.OPERATION.INITIAL);

    const amount = u.useWritableNumber(0);
    const trust_pubkey = u.useWritable("");
    const operator = u.useWritable("");
    const delegate_amount = u.useWritableNumber(0);

    const status = u.useAsync<PosStatus | null>(null);
    const pos = u.useAsync<PosInfo | null>(null);
    const delegations = u.useAsync<Delegations | null>(null);

    u.useNavigateIf(!u.g.user, "/access");
    if (!u.g.user) return <></>;

    // Only a locally-held key can sign a bond/unbond; MetaMask wallets have no pubKey here.
    const pubkey = u.wallet_is_private(u.g.user) ? u.g.user.pubKey : null;

    useEffect(() => {
        refresh();
    }, [node_context.node]);

    function refresh() {
        status.set(u.g.pos_status(node_context));
        if (pubkey) {
            pos.set(u.g.check_pos(node_context, pubkey));
            delegations.set(u.g.delegations(node_context, pubkey));
        }
    }

    function notify(group: string, title: string, body: string) {
        layout.push_notif({ group_id: group, content: u.notif.info(title, body) });
    }

    // A deploy result's first element is the PoS reply `(Bool, Nil|String)`; surface the refusal
    // reason verbatim (the node owns the bond-minimum/maximum and the trust gate).
    function pos_reply(res: u.Unbox<ReturnType<typeof u.g.bond>> | null | undefined): string | null {
        if (!res) { return "No result."; }
        if (res.error) { return res.error; }
        const first = res.expr?.[0];
        if (!first) { return null; }
        const json = rhoExprToJson(first);
        if (Array.isArray(json) && json[0] === false && typeof json[1] === "string") {
            return json[1];
        }
        return null;
    }

    async function make_bond() {
        set_bond_op(u.OPERATION.PENDING);
        try {
            const res = await u.g.bond(node_context, amount.value * DROPS);
            const refusal = pos_reply(res);
            if (refusal) {
                notify("bond-error", "Error", `Bond failed!\n${refusal}`);
            } else {
                notify("bond-success", "Submitted!", "Bond submitted. It takes effect at the next epoch boundary.");
                refresh();
            }
        } catch (err) {
            notify("bond-error", "Error", `Bond failed!\n${String(err)}`);
        }
        set_bond_op(u.OPERATION.INITIAL);
    }

    async function make_unbond() {
        set_unbond_op(u.OPERATION.PENDING);
        try {
            const res = await u.g.unbond(node_context);
            const refusal = pos_reply(res);
            if (refusal) {
                notify("unbond-error", "Error", `Unbond failed!\n${refusal}`);
            } else {
                notify("unbond-success", "Withdrawal staged",
                    "You stay bonded and keep earning until the next epoch boundary, then the bond " +
                    "is quarantined before payout.");
                refresh();
            }
        } catch (err) {
            notify("unbond-error", "Error", `Unbond failed!\n${String(err)}`);
        }
        set_unbond_op(u.OPERATION.INITIAL);
    }

    async function make_delegate() {
        set_delegate_op(u.OPERATION.PENDING);
        try {
            const res = await u.g.delegate(node_context, operator.value.trim(), delegate_amount.value * DROPS);
            const refusal = pos_reply(res);
            if (refusal) {
                notify("delegate-error", "Error", `Delegate failed!\n${refusal}`);
            } else {
                notify("delegate-success", "Submitted!",
                    "Delegation submitted. It joins the operator's pool entry at once and its active " +
                    "set at the next epoch boundary.");
                refresh();
            }
        } catch (err) {
            notify("delegate-error", "Error", `Delegate failed!\n${String(err)}`);
        }
        set_delegate_op(u.OPERATION.INITIAL);
    }

    async function make_undelegate() {
        set_undelegate_op(u.OPERATION.PENDING);
        try {
            const res = await u.g.undelegate(node_context, operator.value.trim());
            const refusal = pos_reply(res);
            if (refusal) {
                notify("undelegate-error", "Error", `Undelegate failed!\n${refusal}`);
            } else {
                notify("undelegate-success", "Undelegation staged",
                    "Your principal stays with the operator and keeps earning (and stays at risk) " +
                    "until the next epoch boundary, then a quarantine elapses before it and its " +
                    "accrued rewards are paid to your vault.");
                refresh();
            }
        } catch (err) {
            notify("undelegate-error", "Error", `Undelegate failed!\n${String(err)}`);
        }
        set_undelegate_op(u.OPERATION.INITIAL);
    }

    async function make_trust(op: "trust" | "untrust") {
        set_trust_op(u.OPERATION.PENDING);
        try {
            const res = await u.g.trust_key(node_context, trust_pubkey.value.trim(), op);
            const refusal = pos_reply(res);
            if (refusal) {
                notify("trust-error", "Error", `${op} failed!\n${refusal}`);
            } else {
                notify("trust-success", "Submitted!", `${op} submitted for ${short_key(trust_pubkey.value.trim())}.`);
                refresh();
            }
        } catch (err) {
            notify("trust-error", "Error", `${op} failed!\n${String(err)}`);
        }
        set_trust_op(u.OPERATION.INITIAL);
    }

    function epoch_panel() {
        if (!pubkey) {
            return <p className="opacity-70">
                Staking requires a locally-held key. This account is read-only (MetaMask), so it
                cannot sign a bond.
            </p>;
        }

        if (status.op === u.OPERATION.PENDING || status.value === null) {
            return <p className="opacity-70">
                {status.error
                    ? `PoS status unavailable: ${String(status.error)}`
                    : "Loading PoS status…"}
            </p>;
        }

        const s = status.value;
        return <div className="flex flex-col gap-1">
            <div className="flex justify-between"><span>Epoch</span><span>{s.epoch}</span></div>
            <div className="flex justify-between">
                <span>Next boundary</span>
                <span>{s.blocksUntilEpochBoundary} block{s.blocksUntilEpochBoundary === 1 ? "" : "s"}</span>
            </div>
            <div className="flex justify-between"><span>Epoch length</span><span>{s.epochLength} blocks</span></div>
            <div className="flex justify-between"><span>Quarantine</span><span>{s.quarantineLength} blocks</span></div>
            <div className="flex justify-between"><span>Active validators</span><span>{s.activeValidators.length}</span></div>
        </div>;
    }

    function stake_panel() {
        const info = pos.value;
        const bonded = info?.bonded ?? 0;
        const trusted = info?.trusted ?? false;
        const s = status.value;
        const active = !!(pubkey && s?.activeValidators.some(v => v.toLowerCase() === pubkey.toLowerCase()));
        const pending = pubkey
            ? s?.pendingWithdrawals.find(w => w.validator.toLowerCase() === pubkey.toLowerCase())
            : undefined;

        return <div className="flex flex-col gap-1">
            <div className="flex justify-between">
                <span>Bonded</span>
                <span>{bonded > 0 ? `${format_rev(bonded)} ${BRAND.ticker}` : "—"}</span>
            </div>
            <div className="flex justify-between">
                <span>Trusted</span>
                <span>{trusted ? "yes" : "no"}</span>
            </div>
            <div className="flex justify-between">
                <span>Active</span>
                <span>{active ? "yes" : "no"}</span>
            </div>
            {pending && (
                <div className="flex justify-between">
                    <span>Withdrawal pending</span>
                    <span>{pending.blocksRemaining} block{pending.blocksRemaining === 1 ? "" : "s"} left</span>
                </div>
            )}
            {!trusted && (
                <p className="text-xs opacity-70 mt-1">
                    Bonding is permissioned: a trusted stakeholder must trust this key before it can bond.
                </p>
            )}
        </div>;
    }

    // The delegator's own positions, across every operator it has staked with (`GET /api/v1/pos/
    // delegations?delegator=…`). The node scopes this to the delegator because the ledger is
    // unbounded in delegator count, so there is no operator-side listing to offer.
    function delegations_panel() {
        const list = delegations.value;

        if (list === null) {
            if (delegations.op === u.OPERATION.PENDING) {
                return <p className="opacity-70">Loading delegations…</p>;
            }
            // `null` is the 404 path: a node that predates the route, or a failed read.
            return <p className="opacity-70">
                {delegations.error
                    ? `Delegations unavailable: ${String(delegations.error)}`
                    : "This node does not expose delegations (it predates the read route)."}
            </p>;
        }

        if (list.length === 0) {
            return <p className="opacity-70">You have no delegations.</p>;
        }

        return <div className="flex flex-col gap-3">
            {list.map(d => (
                <div key={d.operator} className="flex flex-col">
                    <span className="font-mono text-xs break-all">{short_key(d.operator)}</span>
                    <div className="flex justify-between">
                        <span>Delegated</span>
                        <span>{format_rev(d.amount)} {BRAND.ticker}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Accrued rewards</span>
                        <span>{format_rev(d.accruedRewards)} {BRAND.ticker}</span>
                    </div>
                    {d.pendingUndelegation && (
                        <div className="flex justify-between">
                            <span>Undelegation pending</span>
                            <span>
                                {d.pendingUndelegation.blocksRemaining} block
                                {d.pendingUndelegation.blocksRemaining === 1 ? "" : "s"} left
                            </span>
                        </div>
                    )}
                </div>
            ))}
        </div>;
    }

    function validator_panel() {
        const s = status.value;
        if (!s || s.activeValidators.length === 0) {
            return <p className="opacity-70">No active validators reported.</p>;
        }
        return <div className="flex flex-col gap-1 font-mono text-xs">
            {s.activeValidators.map(v => (
                <span key={v} className="break-all">
                    {short_key(v)}
                    {pubkey && v.toLowerCase() === pubkey.toLowerCase() ? " (you)" : ""}
                </span>
            ))}
        </div>;
    }

    return <Components.Strip bg="" className="sm:mt-16">
        <h2 className="flex justify-between items-center">
            <span>Staking</span>
            <Components.Button onClick={refresh} className="p-2 rounded-full">
                <Icon name="refresh-cw" color={"dark:icon-base-900 icon-base-50"} className="w-6 h-6" />
            </Components.Button>
        </h2>

        <div className="ml-2 flex flex-col gap-4">
            <div>
                <h3>Epoch window</h3>
                {epoch_panel()}
            </div>

            <div>
                <h3>Your stake</h3>
                {pubkey ? stake_panel() : <p className="opacity-70">Read-only account — no key to bond.</p>}
            </div>

            {pubkey && <>
                <div>
                    <h3>Bond</h3>
                    <label title="AMOUNT">
                        <input
                            placeholder="AMOUNT"
                            value={amount.str}
                            onChange={amount.write}
                            onBlur={amount.correct}
                        />
                        <p>{BRAND.ticker}</p>
                    </label>
                    <div className="flex justify-end mt-2">
                        <Components.Spinner
                            className="w-8 h-8"
                            op={bond_op}
                            children_initial={
                                <Components.Button
                                    onClick={make_bond}
                                    disabled={amount.value <= 0 || !(pos.value?.trusted ?? false)}>
                                    BOND
                                </Components.Button>
                            }
                        />
                    </div>
                </div>

                <div>
                    <h3>Unbond</h3>
                    <p className="text-sm opacity-80">
                        Stages a withdrawal. You stay bonded and keep earning until the next epoch
                        boundary, then the bond is quarantined for the quarantine length before it
                        (plus accrued rewards) is paid.
                    </p>
                    <div className="flex justify-end mt-2">
                        <Components.Spinner
                            className="w-8 h-8"
                            op={unbond_op}
                            children_initial={
                                <Components.Button
                                    onClick={make_unbond}
                                    disabled={(pos.value?.bonded ?? 0) <= 0}>
                                    STAGE WITHDRAWAL
                                </Components.Button>
                            }
                        />
                    </div>
                </div>

                <div>
                    <h3>Delegate</h3>
                    <p className="text-sm opacity-80">
                        Stake {BRAND.ticker} on a validator you do not run. Any bonded operator is
                        delegable-to — no trust or admission step. Your principal joins that
                        operator's bond (and shares its slash risk) and earns a pro-rata share of its
                        rewards; there is no commission.
                    </p>
                    <label title="OPERATOR PUBLIC KEY">
                        <input
                            placeholder="OPERATOR PUBLIC KEY (hex)"
                            value={operator.value}
                            onChange={operator.write}
                        />
                    </label>
                    <label title="AMOUNT">
                        <input
                            placeholder="AMOUNT"
                            value={delegate_amount.str}
                            onChange={delegate_amount.write}
                            onBlur={delegate_amount.correct}
                        />
                        <p>{BRAND.ticker}</p>
                    </label>
                    <div className="flex justify-between mt-2">
                        <Components.Spinner
                            className="w-8 h-8"
                            op={undelegate_op}
                            children_initial={
                                <Components.Button
                                    onClick={make_undelegate}
                                    disabled={operator.value.trim().length === 0}>
                                    UNDELEGATE
                                </Components.Button>
                            }
                        />
                        <Components.Spinner
                            className="w-8 h-8"
                            op={delegate_op}
                            children_initial={
                                <Components.Button
                                    onClick={make_delegate}
                                    disabled={operator.value.trim().length === 0 || delegate_amount.value <= 0}>
                                    DELEGATE
                                </Components.Button>
                            }
                        />
                    </div>
                    <p className="text-xs opacity-70 mt-1">
                        Undelegating stages the request; your principal keeps earning (and stays at
                        risk) until the next epoch boundary, then a quarantine elapses before payout.
                    </p>
                </div>

                <div>
                    <h3>Your delegations</h3>
                    {delegations_panel()}
                </div>

                {pos.value?.trusted && (
                    <div>
                        <h3>Trust a key</h3>
                        <p className="text-sm opacity-80">
                            Admit another validator public key into the trusted set so it may bond.
                        </p>
                        <label title="VALIDATOR PUBLIC KEY">
                            <input
                                placeholder="VALIDATOR PUBLIC KEY (hex)"
                                value={trust_pubkey.value}
                                onChange={trust_pubkey.write}
                            />
                        </label>
                        <div className="flex justify-between mt-2">
                            <Components.Button
                                onClick={() => make_trust("untrust")}
                                disabled={trust_op === u.OPERATION.PENDING || trust_pubkey.value.trim().length === 0}>
                                UNTRUST
                            </Components.Button>
                            <Components.Spinner
                                className="w-8 h-8"
                                op={trust_op}
                                children_initial={
                                    <Components.Button
                                        onClick={() => make_trust("trust")}
                                        disabled={trust_pubkey.value.trim().length === 0}>
                                        TRUST
                                    </Components.Button>
                                }
                            />
                        </div>
                    </div>
                )}
            </>}

            <div>
                <h3>Active validators</h3>
                {validator_panel()}
            </div>
        </div>
    </Components.Strip>;
}
