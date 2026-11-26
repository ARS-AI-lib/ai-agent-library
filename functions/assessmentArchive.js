// Archive operations on /assessments (2026-11-26). CommonJS; takes `db` so it runs against the real
// Firestore in the callables and against the emulator in verify-assessment-archive-run.cjs.
const { archiveDocId } = require('./assessmentArchiveRules');

const iso = (v) => v?.toDate?.().toISOString() || null;

// Moves every /assessments doc of `year` into /assessmentArchive/{year}/items (in batches), deletes
// the originals, and records the questionnaire config of that moment ONCE (a re-run for stragglers
// grows `count` but never replaces the snapshot).
async function archiveYear({ db, FieldValue, year, by, cfg }) {
  const yearRef = db.collection('assessmentArchive').doc(archiveDocId(year));
  const snap = await db.collection('assessments').where('year', '==', year).get();
  for (let i = 0; i < snap.docs.length; i += 200) {
    const batch = db.batch();
    snap.docs.slice(i, i + 200).forEach((d) => {
      batch.set(yearRef.collection('items').doc(d.id), { ...d.data(), archivedAt: FieldValue.serverTimestamp() });
      batch.delete(d.ref);
    });
    await batch.commit();
  }
  if (snap.size === 0) return { archived: 0 };
  const existing = await yearRef.get();
  await yearRef.set({
    year,
    archivedAt: FieldValue.serverTimestamp(),
    archivedBy: by,
    count: FieldValue.increment(snap.size),
    ...(existing.data()?.configSnapshot ? {} : { configSnapshot: { version: cfg.version || 1, thresholds: cfg.thresholds, questions: cfg.questions } }),
  }, { merge: true });
  return { archived: snap.size };
}

async function listArchivedYears(db) {
  const years = await db.collection('assessmentArchive').get();
  return years.docs
    .map((d) => ({ year: Number(d.id), count: d.data().count || 0, archivedAt: iso(d.data().archivedAt) }))
    .sort((a, b) => b.year - a.year);
}

// { configSnapshot, items[] } with Timestamps as ISO strings (callables cannot carry Timestamps), or null.
async function loadArchivedYear(db, year) {
  const yearRef = db.collection('assessmentArchive').doc(archiveDocId(year));
  const [meta, items] = await Promise.all([yearRef.get(), yearRef.collection('items').limit(5000).get()]);
  if (!meta.exists) return null;
  return {
    configSnapshot: meta.data().configSnapshot,
    items: items.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, createdAt: iso(x.createdAt), archivedAt: iso(x.archivedAt) }; }),
  };
}

module.exports = { archiveYear, listArchivedYears, loadArchivedYear };
