import { useLayout } from 'Context';
import { ModalBase } from './ModalBase';
import * as Components from 'components';

export interface DeployHelpModalProps extends ModalBase<null> {}

// Explains the three deploy operations and the gating (propose is dev-only).
export function DeployHelpModal(props: DeployHelpModalProps) {
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
                    <h3>Deploy operations</h3>
                    <Components.Button className="shrink-0" onClick={close}>CLOSE</Components.Button>
                </div>

                <div className="flex flex-col gap-3 mt-2">
                    <div>
                        <h4>EXPLORE</h4>
                        <p className="opacity-80">Run the editor's rholang read-only against the current chain state and show the result in the output window. No deploy, no fee, no block.</p>
                    </div>
                    <div>
                        <h4>DEPLOY</h4>
                        <p className="opacity-80">Sign the rholang with your key and submit it to the node. It lands in the deploy pool and is included in a block when the node proposes. Track its status in Transactions.</p>
                    </div>
                    <div>
                        <h4>PROPOSE</h4>
                        <p className="opacity-80">Force the node to create a block. Only shown on a devnet / single-node testnet where blocks are not produced automatically.</p>
                    </div>
                </div>
            </Components.Strip>
        </div>
    );
}
