import { refreshAllUI } from '../state/store.js';

export function initRealtimeSync(supabaseClient) {
  if (!supabaseClient) return;

  supabaseClient.channel('custom-all-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, payload => {
      console.log('Realtime change received!', payload);
      // Trigger UI reload/sync logic. Using legacy window.doPull if available.
      if (typeof window.doPull === 'function') {
        window.doPull().then(() => refreshAllUI());
      }
    })
    .subscribe((status) => {
      console.log('Supabase realtime status:', status);
    });
}