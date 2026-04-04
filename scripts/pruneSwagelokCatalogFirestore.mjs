/**
 * swagelok_catalog_parts 에서 "기본 4세그먼트" 품번이 따로 있을 때,
 * 5세그먼트 이상 접미 변형 문서를 삭제합니다 (Admin SDK — 규칙의 delete 무시).
 *
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="...\serviceAccount.json"
 *   node scripts/pruneSwagelokCatalogFirestore.mjs [--dry-run]
 */

import { readFileSync, existsSync } from 'fs';
import admin from 'firebase-admin';

const COLLECTION = 'swagelok_catalog_parts';

function initFirebaseAdmin() {
  if (admin.apps.length) return;
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(inline)) });
    return;
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath || !existsSync(credPath)) {
    throw new Error(
      'Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON for Admin SDK.'
    );
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  initFirebaseAdmin();
  const db = admin.firestore();
  const snap = await db.collection(COLLECTION).get();
  /** @type {Set<string>} */
  const codeSet = new Set();
  snap.forEach((d) => {
    const n = d.data()?.normalized_code;
    if (typeof n === 'string' && n) codeSet.add(n);
  });

  /** @type {FirebaseFirestore.DocumentReference[]} */
  const toDelete = [];
  snap.forEach((d) => {
    const n = d.data()?.normalized_code;
    if (typeof n !== 'string' || !n) return;
    const parts = n.split('-').filter(Boolean);
    if (parts.length <= 4) return;
    const base = parts.slice(0, 4).join('-');
    if (codeSet.has(base)) {
      toDelete.push(d.ref);
    }
  });

  console.log(
    `${COLLECTION}: 접미 변형 후보 ${toDelete.length}건` + (dryRun ? ' (dry-run, 삭제 안 함)' : '')
  );
  if (dryRun) {
    toDelete.slice(0, 30).forEach((ref) => console.log('  -', ref.id));
    if (toDelete.length > 30) console.log(`  … 외 ${toDelete.length - 30}건`);
    return;
  }

  const BATCH = 400;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = db.batch();
    const chunk = toDelete.slice(i, i + BATCH);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  console.log(`삭제 완료: ${toDelete.length}건`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
