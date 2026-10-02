// V7 toast (2026-10-02): tiny event bus so any component can confirm a save
// without prop-drilling. <Toast /> (mounted once in App) listens.
const listeners = new Set();
export function toast(message) {
  listeners.forEach((fn) => fn(String(message || '')));
}
export function onToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
