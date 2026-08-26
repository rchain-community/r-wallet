import { Link } from 'react-router-dom';
import { g } from "utils";
import { useTransactions } from "../../utils/use-transactions";

const STATUS_CLASS: Record<string, string> = {
    pending: "text-yellow-600 dark:text-yellow-400",
    finalized: "text-green-600 dark:text-green-400",
    failed: "text-red-600 dark:text-red-400",
};

// A common live-feed section rendered in-flow at the bottom of every wallet page.
// It is not fixed, so it scrolls with the page like the rest of the content.
export function TransactionFeed() {
    const items = useTransactions();
    if (!g.user || items.length === 0) return null;

    return (
        <div className="w-full max-w-[90vw] mx-auto mt-4">
            <div className="border-t dark:border-base-50 border-base-900 pt-2">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">Live feed</span>
                    <Link to="/history" className="text-xs text-primary-300">HISTORY →</Link>
                </div>
                <ul className="flex flex-col gap-1">
                    {items.slice(0, 3).map((t) => (
                        <li key={t.deployId} className="flex justify-between gap-2 text-xs">
                            <span className="truncate">{t.description}</span>
                            <span className={`uppercase ${STATUS_CLASS[t.status] ?? ""}`}>{t.status}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
