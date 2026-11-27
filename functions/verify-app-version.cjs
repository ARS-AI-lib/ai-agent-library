// Stale-tab detection helpers. node functions/verify-app-version.cjs
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'appVersion.js'), 'utf8').replace(/^export\s+/gm, '');
const M = new Function(`const __APP_VERSION__ = 'v1';\n${code}\n;return { isStale, fetchRemoteVersion, CURRENT_VERSION };`)();
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : ` got ${JSON.stringify(g)} want ${JSON.stringify(w)}`}`); };
(async () => {
  eq('same id → not stale', M.isStale('a', 'a'), false);
  eq('different id → stale', M.isStale('a', 'b'), true);
  eq('dev (no current id) never stale', M.isStale('', 'b'), false);
  eq('failed fetch (no remote id) never stale', M.isStale('a', ''), false);
  eq('current id is baked in', M.CURRENT_VERSION, 'v1');
  eq('reads version from json', await M.fetchRemoteVersion(async () => ({ ok: true, json: async () => ({ version: 'x9' }) })), 'x9');
  eq('http error → empty', await M.fetchRemoteVersion(async () => ({ ok: false })), '');
  eq('network error → empty', await M.fetchRemoteVersion(async () => { throw new Error('offline'); }), '');
  eq('malformed json → empty', await M.fetchRemoteVersion(async () => ({ ok: true, json: async () => ({ v: 1 }) })), '');
  process.exit(fail ? 1 : 0);
})();
