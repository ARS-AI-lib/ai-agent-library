// Stale-tab detection (2026-11-27). A tab that stays open keeps running the bundle it loaded, so after a
// deploy it can still show an old form (a pre-assessment deploy request got filed this way). The build
// bakes an id into the bundle and publishes the same id in /version.json; when they differ, the tab is stale.
export const CURRENT_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';   // '' in dev

// true only when both ids are known and different (never nags in dev or when the fetch failed)
export function isStale(current, remote) {
  return !!current && !!remote && current !== remote;
}

export async function fetchRemoteVersion(fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return '';
    const j = await r.json();
    return typeof j?.version === 'string' ? j.version : '';
  } catch { return ''; }
}
