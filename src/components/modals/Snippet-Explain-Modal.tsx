import { useLayout } from 'Context';
import { ModalBase } from './ModalBase';
import * as Components from 'components';

function humanize(name: string) {
    return name.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
}

export interface SnippetExplainModalProps extends ModalBase<null> {
    name: string;
    description: string;
    purpose: string;
    fields: { name: string }[];
    field_help: Record<string, string>;
}

// Explains the selected contract template: what it does, what it's for, and
// what each field means. Opened from the deploy editor's EXPLAIN button.
export function SnippetExplainModal(props: SnippetExplainModalProps) {
    const layout = useLayout();

    function close() {
        props.onFinish(null);
        layout.pop_modal();
    }

    return (
        <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-xl w-[92vw] text-base-50"
            onClick={(ev) => ev.stopPropagation()}
        >
            <Components.Strip bg="bg-primary-900" className="max-h-[80vh] overflow-auto">
                <div className="flex justify-between items-start gap-4">
                    <h3>{humanize(props.name)}</h3>
                    <Components.Button className="shrink-0" onClick={close}>CLOSE</Components.Button>
                </div>

                <p className="mt-2">{props.description}</p>

                <h4 className="mt-4">What it's for</h4>
                <p>{props.purpose}</p>

                {props.fields.length > 0 && (
                    <>
                        <h4 className="mt-4">Fields</h4>
                        <ul className="flex flex-col gap-2 mt-1">
                            {props.fields.map((f) => (
                                <li key={f.name}>
                                    <code className="font-mono">{f.name}</code>
                                    {props.field_help[f.name] && (
                                        <span className="ml-2 opacity-80">{props.field_help[f.name]}</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </Components.Strip>
        </div>
    );
}
