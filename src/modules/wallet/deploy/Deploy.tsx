import { useState, useRef, useEffect, RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodes, useLayout } from "Context";
import * as Components from "components";
import * as u from 'utils';
import Editor, { loader, type EditorProps } from "@monaco-editor/react";
import { rhoExprToJson } from "api";
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
  const [cost, set_cost] = useState<number|null>(1);
  const [op, set_op] = useState(u.OPERATION.INITIAL);
  const theme = u.useTheme();

  u.useNavigateIf(!u.g.user, "/access");
  if (!u.g.user) return <></>;

  async function clear() {
    code.set("");
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
      phlo_limit.value
    );

    if (!res) {
      set_err("Unknown error!");
      set_msg(null);
      set_cost(null);
      set_op(u.OPERATION.INITIAL);
      return;
    }

    set_err(res?.error);
    set_msg(res?.message);
    set_cost(res?.cost);
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
    set_msg(res?.expr ? JSON.stringify(res?.expr.map(rhoExprToJson), null, 2) : null);
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
                  ADMIN DEPLOY
                </Components.Button>
                  
                <Components.Button
                  disabled={!code.value || phlo_limit.value <= 0}
                  onClick={propose}
                >
                  PROPOSE
                </Components.Button>
                
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
