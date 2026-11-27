import { useEffect, useState } from 'react';
import { CURRENT_VERSION, fetchRemoteVersion, isStale } from '../lib/appVersion';

// "A newer version is available" bar. Checks /version.json every 5 minutes and whenever the tab becomes
// visible again; shows only when the deployed id differs from the one this tab was built with.
const EVERY_MS = 5 * 60 * 1000;

export default function NewVersionBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!CURRENT_VERSION) return undefined;   // dev server
    let alive = true;
    const check = async () => { const v = await fetchRemoteVersion(); if (alive && isStale(CURRENT_VERSION, v)) setStale(true); };
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    const t = setInterval(check, EVERY_MS);
    document.addEventListener('visibilitychange', onVis);
    check();
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" className="nvb">
      <span>มีเวอร์ชันใหม่ของระบบ — กดรีเฟรชก่อนทำรายการต่อ เพื่อไม่ให้ใช้ฟอร์มรุ่นเก่า</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Refresh</button>
    </div>
  );
}
