// One-time bootstrap of /agentVectors, run locally with ADC.
// Mirrors reindexAgentVectors exactly by requiring the same embedText module —
// nothing about the vector contract is re-implemented here.
//
//   node functions/bootstrap-vectors.cjs            # dry run: report only
//   node functions/bootstrap-vectors.cjs --apply    # actually write
//
// After this runs once, the deployed reindexAgentVectors keeps the index fresh.

const { GoogleGenAI } = require('@google/genai');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { EMBED_MODEL, EMBED_DIM, buildEmbedText, contentHash, embedTexts } = require('./embedText');

const APPLY = process.argv.includes('--apply');
const PROJECT = 'wolfy-481609';

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore(app, 'ai-agent-lib');
const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'asia-southeast1' });

(async () => {
  const snap = await db.collection('agents').get();
  const agents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`agents in Firestore: ${agents.length}`);

  const vecSnap = await db.collection('agentVectors').get();
  const existing = new Map(vecSnap.docs.map((d) => [d.id, d.data()?.hash]));
  console.log(`existing vectors:    ${existing.size}`);

  const pending = [];
  let skippedEmpty = 0;
  let skippedFresh = 0;
  agents.forEach((a) => {
    const text = buildEmbedText(a);
    if (!text) { skippedEmpty++; return; }
    const hash = contentHash(text);
    if (existing.get(a.id) === hash) { skippedFresh++; return; }
    pending.push({ id: a.id, name: a.agentName, text, hash });
  });

  console.log(`\nto embed:   ${pending.length}`);
  console.log(`up to date: ${skippedFresh}`);
  console.log(`no text:    ${skippedEmpty}`);
  console.log(`model:      ${EMBED_MODEL} @ ${EMBED_DIM}d`);
  if (pending.length) {
    console.log('\nsample of what will be embedded:');
    pending.slice(0, 3).forEach((p) => console.log(`  · ${p.name}\n      ${p.text.slice(0, 150)}…`));
  }

  if (!APPLY) {
    console.log('\n[dry run] nothing written. re-run with --apply');
    return;
  }
  if (!pending.length) { console.log('\nnothing to do.'); return; }

  console.log('\nembedding…');
  const vectors = await embedTexts(ai, pending.map((p) => p.text), 'RETRIEVAL_DOCUMENT');
  if (vectors.length !== pending.length) {
    throw new Error(`count mismatch: got ${vectors.length}, expected ${pending.length}`);
  }
  const badDim = vectors.findIndex((v) => !Array.isArray(v) || v.length !== EMBED_DIM);
  if (badDim !== -1) throw new Error(`bad vector at ${badDim}: dim=${vectors[badDim]?.length}`);

  for (let i = 0; i < pending.length; i += 400) {
    const batch = db.batch();
    pending.slice(i, i + 400).forEach((p, j) => {
      batch.set(db.collection('agentVectors').doc(p.id), {
        v: vectors[i + j], hash: p.hash, model: EMBED_MODEL, dim: EMBED_DIM,
        updatedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
    console.log(`  wrote ${Math.min(i + 400, pending.length)}/${pending.length}`);
  }
  console.log('\n✅ done');
})().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
