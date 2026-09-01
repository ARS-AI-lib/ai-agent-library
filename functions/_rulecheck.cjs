// Confirms the published rules deny client reads of endpointVersions.
// Uses the CLIENT SDK (rules apply) rather than admin (which bypasses them).
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, initializeFirestore } = require('firebase/firestore');
const fs = require('fs');
const env = fs.readFileSync('../.env.local','utf8'); const cfg = {};
env.split('\n').forEach(l=>{const m=l.match(/^VITE_(\w+)=(.*)$/); if(m) cfg[m[1]]=m[2].trim();});
const app = initializeApp({ apiKey: cfg.FIREBASE_API_KEY, authDomain: cfg.FIREBASE_AUTH_DOMAIN, projectId: cfg.FIREBASE_PROJECT_ID, appId: cfg.FIREBASE_APP_ID });
const db = initializeFirestore(app, {}, 'ai-agent-lib');
(async()=>{
  // Unauthenticated read must be denied for both the new subcollection and
  // the events collection the usage report reads server-side.
  for (const [label, ref] of [
    ['agents/{id}/endpointVersions', collection(db,'agents','1kFtOck4Abf67MO3NvXC','endpointVersions')],
    ['agentEvents', collection(db,'agentEvents')],
  ]) {
    try { const s = await getDocs(ref); console.log(`  ✗ ${label}: READABLE (${s.size} docs) — unexpected`); }
    catch (e) { console.log(`  ✓ ${label}: denied (${e.code})`); }
  }
})();
