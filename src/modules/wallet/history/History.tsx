import * as Components from "components";
import { useTransactions } from "../../../utils/use-transactions";

// Full transaction history (going back in time), as opposed to the live-feed footer.
export function History() {
    const items = useTransactions();

    return (
        <Components.Strip bg="" className="sm:mt-16 max-w-[90vw] w-full">
            <h2>Transaction history</h2>
            <Components.TransactionList items={items} />
        </Components.Strip>
    );
}
