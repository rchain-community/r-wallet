import { useState, useRef, useEffect, RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodes, useLayout } from "Context";
import * as Components from "components";
import * as u from 'utils';
import Editor, { loader, type EditorProps } from "@monaco-editor/react";
import { formatRhoResult } from "api";
import { BRAND } from "../../../config/branding";
import { snippets, snippet_apply, snippet_meta, common_field_help, common_field_defaults, Snippet } from "./snippets";

const snippet_keys = Object.keys(snippets) as Array<keyof typeof snippets>;

interface CodeEditorProps {
  theme: "light"|"dark";
  code: ReturnType<typeof u.useWritable<string>>;
  rootRef: RefObject<HTMLDivElement>;
};

const monaco_load = loader.init();

function CodeEditor(props: CodeEditorProps) {
  if (!props.rootRef.current) return;
  const container = props.rootRef.current;

  let shadow = container.shadowRoot;
  let do_render = false;
  if (!shadow) {
    do_render = true;
    shadow = container.attachShadow({ mode: "open" });
  }

  let root_container: {_root: Root|null} = (shadow as any);

  let root = root_container._root;
  if (!root) {
    root = createRoot(shadow);
    root_container._root = root;
  }

  let editor = <></>;
  const editor_opts: EditorProps = {
    className: "flex-1",
    height: "40vh",
    width: "",
    language: "c",
    theme: props.theme == "dark" ? "vs-dark" : "light",
    value: props.code.value,
    options: { automaticLayout: true },
    onChange(str: string|undefined) { props.code.set(str ?? ""); },
  };

  monaco_load.then(() => {
    if (!shadow.querySelector("link[rel='stylesheet'][data-name='vs/editor/editor.main']")) {
      const style = document.querySelector("link[rel='stylesheet'][data-name='vs/editor/editor.main']");
      if (!style) throw new Error("Monaco style not found!");
      shadow.appendChild(style.cloneNode(true));
    }

    root.render(
      <Editor {...editor_opts} />
    );
  });

  if (do_render) root.render(editor);
}

const ReadcapURI = "rho:id:exfetum749zikr1m87smo7y77gc3rfjpfikzzwa8fj78fr44i3oof5";

function Snippet_Fields(
  props: {
    snippet: Snippet,
    args: (string|null)[],
    set_field: (idx: number, val: any) => void,
    field_help: Record<string, string>
  }
) {
  let fields = props.snippet.fields.map((field, i) => {
    return <label title={props.field_help[field.name] ?? field.name} key={field.name} className="flex-1 basis-28">
          <input placeholder={field.name}
            value={props.args[i] ?? ""}
            onChange={(v) => props.set_field(i, v.target.value)}
          />
    </label>;
  });

  return <div className="flex flex-wrap gap-2">
    {fields}
  </div>
}

interface Attachment {
  name: string;
  size: number;
  hex: string;
}

function Attachments(props: {
  items: Attachment[];
  error: string | null;
  on_add: (files: FileList | null) => void;
  on_remove: (idx: number) => void;
}) {
  return <div className="flex flex-col gap-2">
    <label title="ATTACHMENTS">
      <input
        type="file"
        multiple
        onChange={(e) => { props.on_add(e.target.files); e.target.value = ""; }}
      />
      <p className="text-sm opacity-70">
        Attachments are signed into the deploy (RCHIP #39) and readable in rholang as
        <code> rho:attachment:1</code>, <code>rho:attachment:2</code>, … in order.
      </p>
    </label>
    {props.error && <p className="text-sm text-red-500">{props.error}</p>}
    {props.items.length > 0 && (
      <ul className="flex flex-col gap-1">
        {props.items.map((a, i) => (
          <li key={`${a.name}-${i}`} className="flex items-center gap-2 text-sm">
            <span className="font-mono shrink-0">{`rho:attachment:${i + 1}`}</span>
            <span className="flex-1 truncate" title={a.name}>{a.name}</span>
            <span className="opacity-60 shrink-0">{a.size} B</span>
            <Components.Button onClick={() => props.on_remove(i)}>REMOVE</Components.Button>
          </li>
        ))}
      </ul>
    )}
  </div>;
}

export function Deploy() {
  const node_context = useNodes();
  const layout = useLayout();
  const code = u.useWritable("");
  const output_ref = useRef<HTMLPreElement>(null);
  const editor_ref = useRef<HTMLDivElement>(null);
  const phlo_limit = u.useWritableNumber(500000);
  const [snippet, _set_snippet] = useState<keyof typeof snippets>("blank");
  const [args, set_args] = useState<Array<string|null>>([]);
  const [err,  set_err] = useState<string|null>();
  const [msg,  set_msg] = useState<string|null>();
  const [cost, set_cost] = useState<number|null>(null);
  const [attachments, set_attachments] = useState<Attachment[]>([]);
  const [attach_err, set_attach_err] = useState<string|null>(null);
  const [op, set_op] = useState(u.OPERATION.INITIAL);
  const theme = u.useTheme();

  u.useNavigateIf(!u.g.user, "/access");
  if (!u.g.user) return <></>;

  async function clear() {
    code.set("");
  }

  async function add_attachments(files: FileList | null) {
    if (!files || files.length === 0) { return; }
    set_attach_err(null);
    try {
      const added: Attachment[] = [];
      for (const file of Array.from(files)) {
        added.push({ name: file.name, size: file.size, hex: await u.read_file_hex(file) });
      }
      set_attachments(prev => [...prev, ...added]);
    } catch (err) {
      set_attach_err(u.error_string(err));
    }
  }

  function remove_attachment(idx: number) {
    set_attachments(prev => prev.filter((_, i) => i !== idx));
  }

  async function deploy() {
    if (!u.g.user) { return null; }
    set_op(u.OPERATION.PENDING);

    set_err(null);
    set_msg(null);
    set_cost(null);

    let res = await u.g.deploy_code(
      node_context,
      code.value,
      phlo_limit.value,
      attachments.map(a => a.hex)
    );

    if (!res) {
      set_err("Unknown error!");
      set_msg(null);
      set_cost(null);
      set_op(u.OPERATION.INITIAL);
      return;
    }

    set_err(res?.error);
    set_msg(formatRhoResult(res?.expr));
    set_cost(null);
    set_op(u.OPERATION.INITIAL);
  }

  async function propose() {
    if (!u.g.user) { return null; }
    set_op(u.OPERATION.PENDING);

    set_err(null);
    set_msg(null);
    set_cost(null);

    let res = await u.g.propose(
      node_context
    );

    if (!res) {
      set_err("Unknown error!");
      set_msg(null);
      set_cost(null);
      set_op(u.OPERATION.INITIAL);
      return;
    }

    set_err(res?.error);
    set_op(u.OPERATION.INITIAL);
  }

  async function explore() {
    if (!u.g.user) { return null; }
    set_op(u.OPERATION.PENDING);

    set_err(null);
    set_msg(null);
    set_cost(null);

    let res = await u.g.explore_code(
      node_context, code.value
    );

    if (!res) {
      set_err("Unknown error!");
      set_msg(null);
      set_cost(null);
      set_op(u.OPERATION.INITIAL);
      return;
    }

    set_err(res?.error);
    set_msg(formatRhoResult(res?.expr));
    set_op(u.OPERATION.INITIAL);
  }

  function show_output() {
    if (err) return err;
    if (msg) return msg;
    return "";
  }

  function set_arg(idx: number, val: any) {
    let new_args = [...args];
    new_args[idx] = val;
    set_args(new_args);
    update_code(snippet, new_args);
  }

  function show_cost() {
    if (!cost) { return <></>; }

    return (<div className="flex justify-between">
      <p>Deployment cost:</p>
      <span>{cost} ×10<sup>-8</sup> {BRAND.ticker}</span>
    </div>)
  }

  function update_code(snippet_name=snippet, snippet_args=args) {
    code.set(snippet_apply(snippet_name, snippet_args));
  }

  function set_snippet(name: keyof typeof snippets) {
    let s = snippets[name];
    if (!s) return;

    if (name != snippet) {
      _set_snippet(name);
      const meta = snippet_meta[name];
      let new_args = s.fields.map(field =>
        meta.defaults?.[field.name]
        ?? common_field_defaults[field.name]
        ?? (field.type === "MasterURI" ? ReadcapURI
          : field.type === "walletRevAddr" ? (u.g.user?.revAddr ?? "")
          : null)
      );
      set_args(new_args);
      update_code(name, new_args);
    }
  }

  function snippet_option(snippet: keyof typeof snippets) {
    return <option key={snippet} value={snippet}>{snippet}</option>
  }

  function explain_snippet() {
    layout.push_modal({
      component: Components.SnippetExplainModal,
      props: {
        name: snippet as string,
        description: snippet_meta[snippet].description,
        purpose: snippet_meta[snippet].purpose,
        fields: snippets[snippet].fields,
        field_help: { ...common_field_help, ...snippet_meta[snippet].fieldHelp },
        onFinish: () => {},
      },
    });
  }

  function help_deploy() {
    layout.push_modal({
      component: Components.DeployHelpModal,
      props: { onFinish: () => {} },
    });
  }

  useEffect(
    () => CodeEditor({
      rootRef: editor_ref,
      code, theme
    }),
    [editor_ref.current, code]
  );

  useEffect(() => {
    if (err || msg) {
      if (output_ref.current) {
        output_ref.current.scrollIntoView({behavior: "smooth"});
      }
    }
  }, [err, msg]);

  return <Components.Strip bg="" className="sm:mt-16 max-w-[90vw] w-full">
      <h2>Deploy Rholang Code</h2>

      {layout.help_mode && (
        <p className="text-sm opacity-70">EXPLORE evaluates read-only and shows the result in the output window. DEPLOY signs and submits your rholang (track its status in Transactions). Attach files to pass binary data in as `rho:attachment:1`, `rho:attachment:2`, … PROPOSE forces a block and only appears on a devnet.</p>
      )}

      <div className="flex flex-col md:flex-row gap-4">

        <div className="flex flex-col flex-1 gap-4 overflow-hidden">
          <div className="flex items-end gap-2">
            <label title="SNIPPET" className="flex-1">
              <select value={snippet} onChange={ (v) => set_snippet(v.target.value as keyof typeof snippets) }>
                {snippet_keys.map(snippet_option)}
              </select>
            </label>
            <Components.Button onClick={explain_snippet}>
              EXPLAIN
            </Components.Button>
            <Components.Button onClick={help_deploy}>
              ?
            </Components.Button>
          </div>

          <Snippet_Fields
            snippet={snippets[snippet]}
            args={args}
            set_field={set_arg}
            field_help={{ ...common_field_help, ...snippet_meta[snippet].fieldHelp }}
          />

          <div className="flex-1 flex flex-col border dark:border-base-50 border-base-900 rounded-xl overflow-hidden" ref={editor_ref}></div>

          <label title="PHLO LIMIT">
            <input placeholder="PHLO LIMIT"
              value={phlo_limit.str}
              onChange={phlo_limit.write}
              onBlur={phlo_limit.correct}
            />
            <p>×10<sup>-8</sup> {BRAND.ticker}</p>
          </label>

          <Attachments
            items={attachments}
            error={attach_err}
            on_add={add_attachments}
            on_remove={remove_attachment}
          />

          <div className="flex justify-end items-center flex-wrap gap-2">
            <Components.Button className="mr-auto" onClick={clear}>
              CLEAR
            </Components.Button>

            <Components.Spinner op={op}
              className="w-8 h-8"
              children_initial={<>
                <Components.Button
                  disabled={!code.value || phlo_limit.value <= 0}
                  onClick={explore}
                >
                  EXPLORE
                </Components.Button>

                <Components.Button
                  disabled={!code.value || phlo_limit.value <= 0}
                  onClick={deploy}
                  >
                  DEPLOY
                </Components.Button>

                {node_context.capabilities?.adminHttp && (
                  <Components.Button
                    disabled={!code.value || phlo_limit.value <= 0}
                    onClick={propose}
                  >
                    PROPOSE
                  </Components.Button>
                )}
                
              </>}
            />
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          <h3>Output</h3>
          { show_cost() }
          <pre ref={output_ref} className="font-mono flex-1 whitespace-pre-wrap p-4 break-words dark:bg-base-800 max-h-[55vh] overflow-auto bg-base-200 border dark:border-base-50 border-base-900">{show_output()}</pre>
        </div>
      </div>

    </Components.Strip>;
}
