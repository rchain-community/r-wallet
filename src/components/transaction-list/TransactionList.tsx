import type { TransactionRecord } from "../../utils/transactions";

const STATUS_CLASS: Record<string, string> = {
    pending: "text-yellow-600 dark:text-yellow-400",
    finalized: "text-green-600 dark:text-green-400",
    failed: "text-red-600 dark:text-red-400",
};

// Presentational list of transaction records (used by the history page).
export function TransactionList({ items }: { items: TransactionRecord[] }) {
    if (items.length === 0) {
        return <p className="text-sm opacity-70">No transactions yet.</p>;
    }

    return (
        <ul className="flex flex-col gap-3">
            {items.map((t) => (
                <li key={t.deployId} className="border dark:border-base-50 border-base-900 rounded-lg p-3">
                    <div className="flex justify-between gap-2">
                        <span className="font-medium">{t.description}</span>
                        <span className={`text-xs uppercase ${STATUS_CLASS[t.status] ?? ""}`}>{t.status}</span>
                    </div>
                    {t.error && <p className="text-xs text-red-600 dark:text-red-400 break-words">{t.error}</p>}
                    <p className="text-xs opacity-60 font-mono break-all">{t.deployId}</p>
                </li>
            ))}
        </ul>
    );
}
