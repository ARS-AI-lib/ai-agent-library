#!/usr/bin/env node
/**
 * Move library-hosted skill files off public Firebase Hosting and behind the
 * SSO-gated /f/{agentId} download (2026-08-18).
 *
 * ── Why ──
 * Everything under public/skills/ is served by Firebase Hosting, which is a
 * CDN with no auth layer. Measured before this was written:
 *
 *     curl https://wolfy-ai-library.web.app/skills/duplicate-check.zip
 *     → HTTP 200 · 4,879 bytes · no cookie, no token, no VPN
 *
 * All 25 library endpoints were open to the internet. This script moves the
 * bytes into a private Cloud Storage bucket and repoints each agent at
 * /f/{agentId}, which resolves to the SPA and forces Google SSO first.
 *
 * ── What it does NOT touch ──
 *   · The 38 endpoints on gitdev.devops.krungthai.com and 2 on Cloud Run.
 *     Those are other systems' links; VPN is their gate, not us.
 *   · The 2 agents whose endpoint is the app homepage itself ("/") —
 *     AI Agent Library Chat Assistant and Copilot. Those are "go use the app"
 *     links with no file behind them, and the app already requires login.
 *
 * ── Why the Figma folders get zipped ──
 * 16 agents point at a single SKILL.md inside a folder that also holds
 * references/ and scripts/ (figma-generate-library has 16 files, figma-use has
 * 21). Anyone downloading today gets a SKILL.md whose internal references
 * resolve to nothing — the endpoint has been quietly half-broken since it was
 * set. Zipping the whole folder fixes that as a side effect and gives the
 * authed download a single file to serve, which is what it needs anyway.
 *
 * ⚠️ RUN ORDER: deploy the hosting bundle FIRST. A /f/ URL only works once the
 * deployed SPA knows that route (src/main.jsx); against the old bundle it just
 * renders the library instead of downloading.
 *
 * ⚠️ public/skills/* is deliberately NOT deleted here. Verify the new path
 * live, then remove it in a separate commit — that half is irreversible.
 *
 * Usage:  node functions/migrate-skill-files.cjs           # dry run
 *         node functions/migrate-skill-files.cjs --apply   # write
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const PROJECT = 'wolfy-481609';
const BUCKET = 'wolfy-481609.appspot.com';
const DB_ID = 'ai-agent-lib';
const PUBLIC_SKILLS = path.join(__dirname, '..', 'public', 'skills');
const CANONICAL_ORIGIN = 'https://wolfy-ai-library.web.app';
const LIBRARY_HOSTS = new Set(['wolfy-ai-library.web.app', 'wolfy-481609.web.app']);

admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
const db = admin.firestore();
db.settings({ databaseId: DB_ID });
const bucket = admin.storage().bucket(BUCKET);

const CONTENT_TYPE = {
  zip: 'application/zip', md: 'text/markdown', txt: 'text/plain',
  pdf: 'application/pdf', csv: 'text/csv',
};

/**
 * Work out what local file backs an endpoint, and what it should be called.
 * Returns null for anything this script must not touch.
 */
function planFor(endpoint) {
  let u;
  try {
    u = new URL(String(endpoint).trim());
  } catch {
    return null;
  }
  if (!LIBRARY_HOSTS.has(u.hostname)) return null;         // external — leave alone
  const parts = u.pathname.split('/').filter(Boolean);
  if (!parts.length) return { skip: 'app homepage (no file)' };
  if (parts[0] !== 'skills') return { skip: `unrecognised path /${parts.join('/')}` };

  // /skills/foo.zip  → ship that file as-is
  if (parts.length === 2 && parts[1].endsWith('.zip')) {
    const src = path.join(PUBLIC_SKILLS, parts[1]);
    if (!fs.existsSync(src)) return { skip: `missing local file ${parts[1]}` };
    return { kind: 'file', src, name: parts[1] };
  }
  // /skills/<dir>/SKILL.md (or any file inside a skill folder) → zip the folder
  if (parts.length >= 2) {
    const dir = path.join(PUBLIC_SKILLS, parts[1]);
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      return { skip: `missing local folder ${parts[1]}` };
    }
    return { kind: 'zipdir', src: dir, name: `${parts[1]}.zip` };
  }
  return { skip: `unhandled ${u.pathname}` };
}

/** Zip a skill folder so its references/ and scripts/ travel with SKILL.md. */
function zipFolder(dir, outName, tmp) {
  const out = path.join(tmp, outName);
  // -r recurse, -q quiet, -X drop extra file attributes so the archive is
  // reproducible. Run from the parent so paths inside the zip stay relative
  // to the skill folder rather than embedding the whole machine path.
  execFileSync('zip', ['-rqX', out, path.basename(dir)], { cwd: path.dirname(dir) });
  return out;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillzip-'));
  const snap = await db.collection('agents').get();
  const live = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.approvalStatus === 'approved' && a.archived !== true);

  const targets = live.filter((a) => {
    try {
      return LIBRARY_HOSTS.has(new URL(String(a.endpoint || '').trim()).hostname);
    } catch { return false; }
  });

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — library-hosted endpoints found: ${targets.length}\n`);

  const skipped = [];
  const planned = [];
  for (const a of targets) {
    const plan = planFor(a.endpoint);
    if (!plan || plan.skip) skipped.push({ a, why: plan?.skip || 'not a library URL' });
    else planned.push({ a, plan });
  }

  console.log(`── จะย้าย ${planned.length} agent ──`);
  const files = new Set();
  for (const { a, plan } of planned) {
    files.add(plan.name);
    console.log(
      `  ${(a.agentName || '').slice(0, 32).padEnd(34)} ${plan.kind === 'zipdir' ? 'zip folder' : 'file      '} → ${plan.name}`,
    );
    console.log(`      ${String(a.endpoint).replace(CANONICAL_ORIGIN, '')}  →  /f/${a.id}`);
  }
  console.log(`\n  ไฟล์ที่ต้องอัปโหลด (นับซ้ำได้ เพราะ 1 agent = 1 สำเนา): ${planned.length} · ชื่อไฟล์ไม่ซ้ำ: ${files.size}`);

  console.log(`\n── ข้าม ${skipped.length} agent ──`);
  skipped.forEach(({ a, why }) => console.log(`  ${(a.agentName || '').slice(0, 32).padEnd(34)} ${why}`));

  if (!APPLY) {
    console.log('\ndry run — ยังไม่เขียนอะไร  (ใส่ --apply เพื่อทำจริง)');
    fs.rmSync(tmp, { recursive: true, force: true });
    return;
  }

  // ⛔ Hard abort (2026-08-26). This script writes an UNVERSIONED storagePath
  // and stamps endpointFile directly, bypassing attachEndpointFile's version
  // reservation entirely. Re-running it against an agent that already has a
  // version history would silently desync the audit log from Storage and
  // strand the object it overwrites. It was a one-shot migration; treat it
  // as frozen.
  for (const { a } of planned) {
    const existing = await db.collection('agents').doc(a.id)
      .collection('endpointVersions').limit(1).get();
    if (!existing.empty) {
      console.error(`\n✗ ABORT: "${a.agentName}" already has an endpointVersions history.`);
      console.error('  This script predates file versioning and would corrupt it. Use the app\'s upload instead.');
      process.exit(1);
    }
  }

  console.log('\n── uploading ──');
  let ok = 0;
  for (const { a, plan } of planned) {
    const local = plan.kind === 'zipdir' ? zipFolder(plan.src, plan.name, tmp) : plan.src;
    const buf = fs.readFileSync(local);
    const storagePath = `endpointFiles/${a.id}/${plan.name}`;
    const ext = plan.name.split('.').pop().toLowerCase();
    await bucket.file(storagePath).save(buf, {
      contentType: CONTENT_TYPE[ext] || 'application/octet-stream',
      resumable: false,
      // No public ACL, no download token — getEndpointFile is the only door.
      metadata: { cacheControl: 'private, max-age=0', metadata: { agentId: a.id, uploadedBy: 'migration' } },
    });
    await db.collection('agents').doc(a.id).update({
      endpoint: `${CANONICAL_ORIGIN}/f/${encodeURIComponent(a.id)}`,
      endpointFile: {
        name: plan.name,
        size: buf.length,
        contentType: CONTENT_TYPE[ext] || 'application/octet-stream',
        storagePath,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        uploadedBy: 'migration',
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    ok += 1;
    console.log(`  ✓ ${(a.agentName || '').slice(0, 34).padEnd(36)} ${plan.name} (${buf.length} B)`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nเสร็จ: ${ok}/${planned.length}`);
  console.log('ขั้นต่อไป: ตรวจว่า /f/ ใช้งานได้จริงก่อน แล้วค่อยลบ public/skills/* ใน commit แยก');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
