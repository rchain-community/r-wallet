import { useState, useEffect } from 'react';
import { useNodes } from '../Context';
import { tx_list, refresh_tx_states } from './transactions';

// Shared poller for the transaction list: refreshes pending deploys (via
// deploy-status + the node's pooled-deploys endpoint) on an interval and returns
// the current records. Used by both the live feed and the history page.
export function useTransactions() {
    const node_context = useNodes();
    const url = node_context.get_validator_url();
    const [items, set_items] = useState(tx_list);

    useEffect(() => {
        let cancelled = false;
        async function refresh() {
            await refresh_tx_states(url);
            if (!cancelled) set_items([...tx_list]);
        }
        refresh();
        const id = setInterval(refresh, 5000);
        return () => { cancelled = true; clearInterval(id); };
    }, [url]);

    return items;
}
