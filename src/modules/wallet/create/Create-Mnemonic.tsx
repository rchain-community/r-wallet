import { useState } from 'react';
import { bc, g } from 'utils';
import * as u from 'utils';
import { useNavigate } from 'react-router-dom';
import { useLayout } from 'Context';
import * as Components from 'components';

export function CreateMnemonic() {
  const navigate = useNavigate();
  const layout = useLayout();
  const [ mnemonic ] = useState(bc.generate_mnemonic(256));
  const [ step, set_step ] = useState(0);
  const word1  = u.useWritable("");
  const word8  = u.useWritable("");
  const word16 = u.useWritable("");
  const [ words_correct, set_words_correct ] = useState(false);

  function mnemonic_word(word: string, idx: number) {
    return <div className="flex" key={word}>
      <span className="opacity-50 flex-static select-none">{idx+1}. </span>
      <span className="flex-1 text-center">{word}</span>
    </div>;
  }

  function mnemonic_words() {
    let words = mnemonic.split(" ").map(mnemonic_word);
    return <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 counter-[mnemonic]">
      { words }
    </div>;
  }

  async function register() {
    const account_data = await bc.get_account_from_mnemonic(mnemonic);

    if (account_data === null) {
      layout.push_notif({
        group_id: "create-mnemonic-error",
        content: <>
          <h3>Error</h3>
          <p>An error occurred while trying to create a new wallet.</p>
        </>
      });
      return;
    }

    const user = g.create_user("My Wallet", "", account_data);
    g.set_active_user(user);
    navigate("/balance");
  }

  function copy() {
    navigator.clipboard.writeText(mnemonic);
  }

  async function download() {
    let blobUrl = u.bc.create_blob(mnemonic);
    await u.download_blob(blobUrl, "mnemonic.txt");
    window.URL.revokeObjectURL(blobUrl);
  }

  function set_word_1(ev: any) {
    word1.write(ev);
    check_words(ev.target.value, word8.value, word16.value);
  }

  function set_word_8(ev: any) {
    word8.write(ev);
    check_words(word1.value, ev.target.value, word16.value);
  }

  function set_word_16(ev: any) {
    word16.write(ev);
    check_words(word1.value, word8.value, ev.target.value);
  }

  function check_words(word1: string, word8: string, word16: string) {
    let words = mnemonic.split(" ");
    if (word1 !== words[0]) { set_words_correct(false); return; }
    if (word8 !== words[7]) { set_words_correct(false); return; }
    if (word16 !== words[15]) { set_words_correct(false); return; }
    set_words_correct(true);
  }

  function reset_words() {
    word1.set("");
    word8.set("");
    word16.set("");
  }

  function render_step() {
    switch (step) {
      case 0:
        return <>
          <p className="max-w-96">
            The below words are your mnemonic phrase. Make sure to copy
            them somewhere safe - you will not be able to access your wallet
            without them.
          </p>

          { mnemonic_words() }

          <div className="flex justify-between mt-8">
            <Components.Button onClick={() => navigate("/")}>
              BACK
            </Components.Button>

            <Components.Button onClick={()=>set_step(1)}>
              NEXT STEP
            </Components.Button>
          </div>
        </>;

      case 1:
        return <>
          <p className="max-w-96">
            Now that you have written down your mnemonic phrase,
            please copy the 1st, 8th and 16th word into the boxes
            below to make sure that they match.
          </p>
          <div className="flex flex-col gap-2">
            <label title="1st WORD">
              <input placeholder="1st WORD" value={word1.value} onChange={set_word_1} />
            </label>

            <label title="8th WORD">
              <input placeholder="8th WORD" value={word8.value} onChange={set_word_8} />
            </label>

            <label title="16th WORD">
              <input placeholder="16th WORD" value={word16.value} onChange={set_word_16} />
            </label>
          </div>

          <p></p>

          <div className="flex justify-between mt-8">
            <Components.Button
              onClick={()=>{ reset_words(); set_step(0) }}
            >
              BACK
            </Components.Button>

            <Components.Button
              disabled={!words_correct}
              onClick={() => set_step(2)}
            >
              CONTINUE
            </Components.Button>
          </div>
        </>

      case 2:
        return <>
          <p className="max-w-96">
            Success! Before you continue to your new wallet,
            feel free to copy your mnemonic or download it
            as a file, for backup.
          </p>

          <div className="flex justify-between mt-8 mb-8">
            <Components.Button onClick={download}>
              DOWNLOAD
            </Components.Button>
            <Components.Button onClick={copy}>
              COPY
            </Components.Button>
          </div>

          <Components.Button className="w-fit mx-auto" onClick={register}>
            CONTINUE TO YOUR WALLET
          </Components.Button>
        </>
    }
  }

  return (
    <Components.Strip bg="" className="sm:mt-16">
      <h2 className="mb-8">Create a New Wallet</h2>
      { render_step() }
    </Components.Strip>
  );
}
