import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DEFAULT_CONFIG } from '../lib/screening';

// Live /config/screening (Assessment Settings, 2026-11-26). Falls back to DEFAULT_CONFIG until the
// doc arrives or when it is missing/invalid, so the registration and deploy flows never break.
// Writes never happen here: they go through the manageScreeningConfig callable.
export function useScreeningConfig() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => onSnapshot(
    doc(db, 'config', 'screening'),
    (snap) => {
      const d = snap.exists() ? snap.data() : null;
      setCfg(d && Array.isArray(d.questions) && d.questions.length && d.thresholds ? d : null);
    },
    () => setCfg(null),
  ), []);
  return cfg || DEFAULT_CONFIG;
}
