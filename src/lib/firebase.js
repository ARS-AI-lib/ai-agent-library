import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
// Requested at every normal sign-in (not a separate popup) so the "Creator /
// Team member" picker in PreRegModal can search the Workspace directory via
// the People API — see src/lib/directory.js for how the resulting token is
// captured and used.
googleProvider.addScope('https://www.googleapis.com/auth/directory.readonly');

// ⚠️ Named (non-default) Firestore database — ต้องระบุชื่อ DB ตรงนี้เสมอ
// (ตามที่บันทึกไว้: getFirestore(app) เปล่าๆ จะไปชี้ default DB ผิดตัว)
export const FIRESTORE_DB_ID = 'ai-agent-lib';
export const db = getFirestore(app, FIRESTORE_DB_ID);

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
