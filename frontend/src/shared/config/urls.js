// Public build-time URLs only. Use an empty base for a shared production origin.
const landingBase = (
  import.meta.env.VITE_LANDINGPAGE_URL ||
  (import.meta.env.DEV ? 'http://localhost:5174' : '')
).replace(/\/+$/, '');
export const landingPageUrl = (path = '/') => `${landingBase}${path}`;
