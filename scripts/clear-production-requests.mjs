/**
 * productionRequests 컬렉션 전체 삭제 (Admin SDK)
 *
 *   node scripts/clear-production-requests.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import admin from 'firebase-admin';

const COLLECTION = 'productionRequests';

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY 가 필요합니다.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

async function main() {
  loadEnvLocal();
  const dryRun = process.argv.includes('--dry-run');
  initFirebaseAdmin();
  const db = admin.firestore();
  const snap = await db.collection(COLLECTION).get();

  console.log(`${COLLECTION}: ${snap.size}건` + (dryRun ? ' (dry-run, 삭제 안 함)' : ''));
  if (dryRun || snap.empty) {
    return;
  }

  const BATCH = 400;
  const refs = snap.docs.map((d) => d.ref);
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = db.batch();
    refs.slice(i, i + BATCH).forEach((ref) => batch.delete(ref));
    await batch.commit();
    console.log(`삭제 진행: ${Math.min(i + BATCH, refs.length)} / ${refs.length}`);
  }
  console.log(`삭제 완료: ${refs.length}건`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
