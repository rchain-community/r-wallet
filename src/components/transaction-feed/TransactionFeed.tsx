import { Link } from 'react-router-dom';
import { g } from "utils";
import { useTransactions } from "../../utils/use-transactions";

const STATUS_CLASS: Record<string, string> = {
    pending: "text-yellow-600 dark:text-yellow-400",
    finalized: "text-green-600 dark:text-green-400",
    failed: "text-red-600 dark:text-red-400",
};

// A fixed live-feed footer common to all wallet pages. Fixed positioning means it
// does not resize the main content when transactions appear.
export function TransactionFeed() {
    const items = useTransactions();
    if (!g.user || items.length === 0) return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t dark:border-base-50 border-base-900 bg-base-50 dark:bg-base-900/95 backdrop-blur-sm px-4 py-2">
            <div className="flex items-center justify-between mb-1">
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
    );
}
