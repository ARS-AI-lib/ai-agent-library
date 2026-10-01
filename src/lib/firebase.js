import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// ── Firebase config ──────────────────────────────────────────────
// ค่าจริงดึงจาก Firebase Console > Project Settings > Your apps > Web app
// ห้าม commit ค่าจริงเข้า git — ใส่ใน .env.local (ดู .env.example)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'wolfy-481609.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'wolfy-481609',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'wolfy-481609.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// NOTE: normal sign-in requests only basic profile/email (non-sensitive) — the
// People API `directory.readonly` scope is a SENSITIVE scope that made the
// unverified-app consent screen block some users at login. It's now requested
// on-demand, only when an admin clicks "Sync directory now" (see
// acquireDirectoryToken in src/lib/directory.js). Everyone else reads the
// Firestore-cached directory, which needs no Google token at all.

// ⚠️ Named (non-default) Firestore database — ต้องระบุชื่อ DB ตรงนี้เสมอ
// (ตามที่บันทึกไว้: getFirestore(app) เปล่าๆ จะไปชี้ default DB ผิดตัว)
export const FIRESTORE_DB_ID = 'ai-agent-lib';
export const db = getFirestore(app, FIRESTORE_DB_ID);

// ── Local emulators (dev only) ───────────────────────────────────
// VITE_USE_EMULATOR=1 lives only in .env.development.local (gitignored), so a
// production build never contains this branch's effect. getFunctions() caches
// one instance per region, so wiring the asia-southeast1 instance here covers
// every httpsCallable(getFunctions(undefined, 'asia-southeast1'), …) call site.
export const USING_EMULATOR = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === '1';
if (USING_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(getFunctions(app, 'asia-southeast1'), '127.0.0.1', 5001);
}

// ── Allowed auth domains (ต้องตรงกับ Firestore Security Rules ฝั่ง server) ──
export const ALLOWED_EMAIL_DOMAINS = ['arise.tech', 'infinitaskt.com'];

export function isAllowedEmail(email) {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

// Human-readable "@a / @b" list — single source of truth for all UI copy so
// the allowed-domain wording can never drift from the actual check again.
export const ALLOWED_DOMAINS_LABEL = ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' / ');
