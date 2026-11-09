// Public build-time URLs only. Use an empty base for a shared production origin.
const pmsBase = (
  import.meta.env.VITE_PMS_URL ||
  (import.meta.env.DEV ? 'http://localhost:5173' : '')
).replace(/\/+$/, '');
export const pmsUrl = (path = '/id/login') => `${pmsBase}${path}`;
