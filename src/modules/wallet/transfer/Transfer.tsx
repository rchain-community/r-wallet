import { useState } from 'react';
import { useLayout, useNodes } from "Context";
import * as u from 'utils';
import { Icon } from "assets";
import * as Components from "components";
import { BRAND } from "../../../config/branding";

export function Transfer() {
  let name = "";
  if (u.g.user && u.g.user.password) {
    name = u.g.user.name;
  }

  const sender_name = u.useWritable(name);
  const receiver = u.useWritable("");
  const receiver_name = u.useWritable("");
  const amount = u.useWritableNumber(0);
  const node_context = useNodes();
  const layout = useLayout();

  const [op, set_op] = useState(u.OPERATION.INITIAL);

  function reset() {
    sender_name.set(name);
    receiver.set("");
    receiver_name.set("");
    amount.correct("0");
  }

  function transfer_valid() {
    return sender_name.value.length > 0 &&
      receiver_name.value.length > 0 &&
      receiver.value.length > 0 &&
      amount.value > 0;
  }

  async function make_transfer() {
    if (!u.g.user) { return; }

    let from_wallet: u.UserWallet | u.UserMetaMaskWallet = {
      ...u.g.user,
      name: sender_name.value,
      password: ""
    };

    let receiver_wallet = await u.bc.get_account(receiver.value);

    if (receiver_wallet === null) {
      layout.push_notif({
        group_id: "transfer-error",
        content: u.notif.info("Error", "Invalid receiver wallet!")
      });
      set_op(u.OPERATION.INITIAL);
      return;
    }

    let to_wallet: u.NamedWallet = { ...receiver_wallet, name: receiver_name.value };
    try {
      set_op(u.OPERATION.PENDING);
      let res = await u.g.transfer(node_context, amount.value * 100000000, from_wallet, to_wallet);

      if (!res) {
        layout.push_notif({
          group_id: "transfer-error",
          content: u.notif.info("Error", `Transfer failed!`)
        });
      } else if (res.error) {
        layout.push_notif({
          group_id: "transfer-error",
          content: u.notif.info("Error", `Transfer failed!\n${res.error}`)
        });
      } else {
        layout.push_notif({
          group_id: "transfer-success",
          content: u.notif.info("Success!", "Your transfer is successful, but not finalized yet. Check your balance again in a few minutes.")
        });
      }

      set_op(u.OPERATION.INITIAL);
    } catch (err) {
      layout.push_notif({
        group_id: "transfer-error",
        content: u.notif.info("Error", `Transfer failed!\n${String(err)}`)
      });
      set_op(u.OPERATION.INITIAL);
    }
  }

  u.useNavigateIf(!u.g.user, "/access");
  if (!u.g.user) return <></>;

  return <Components.Strip bg="" className="sm:mt-16">
    <h2>Transfer</h2>

    <div className="ml-2 flex flex-col gap-2">
      <h3>From</h3>

      <div className="mb-2">
        <p>{BRAND.ticker} Address</p>
        <p className="font-mono ml-2 break-all">
          { u.g.user?.revAddr }
        </p>
      </div>

      <label title="SENDER NAME">
        <input
          placeholder="SENDER NAME"
          value={sender_name.value}
          onChange={sender_name.write}
        />
      </label>

      <label title="AMOUNT">
        <input
          placeholder="AMOUNT"
          value={amount.str}
          onChange={amount.write}
          onBlur={amount.correct}
        />
        <p>{BRAND.ticker}</p>
      </label>

      <Icon name="arrow" color="icon-base-50" className="self-center my-4" />

      <h3>To</h3>
      <label title="RECEIVER NAME">
        <input
          placeholder="RECEIVER NAME"
          value={receiver_name.value}
          onChange={receiver_name.write}/>
      </label>

      <label title="ADDRESS">
        <input
          placeholder="ADDRESS"
          value={receiver.value}
          onChange={receiver.write}/>
      </label>

      <div className="flex justify-between mt-8">
        <Components.Button onClick={reset}>
          RESET
        </Components.Button>

        <Components.Spinner
          className="w-8 h-8"
          op={op}
          children_initial={
            <Components.Button
              onClick={make_transfer}
              disabled={!transfer_valid()}>
                SEND
            </Components.Button>
          }
        />

      </div>
    </div>
  </Components.Strip>;
}
