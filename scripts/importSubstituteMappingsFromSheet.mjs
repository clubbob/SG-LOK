/**
 * Firestore `mappings` 일괄 삽입 (기존 문서는 건너뜀 — 관리자 시드와 동일).
 *
 * 준비:
 * 1) Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키(JSON) 저장
 * 2) PowerShell 예시:
 *    $env:GOOGLE_APPLICATION_CREDENTIALS="D:\path\to\serviceAccount.json"
 *    node scripts/importSubstituteMappingsFromSheet.mjs data/imports/cross.xlsx
 *
 * 파일 형식:
 * - .xlsx / .xls / .csv
 * - 첫 행: 헤더. Swagelok 열(이름 예: swagelok, code_from, Swagelok) + S-LOK 열(slok, code_to, S-LOK)
 * - 선택: product_name_from, product_name_to, remarks
 *
 * 옵션:
 *   --dry-run   Firestore 쓰기 없이 행만 검사
 *   --actor=이름   created_by/updated_by (기본: catalog-import)
 *
 * PDF만 있는 경우: 표를 Excel로 옮긴 뒤 이 스크립트를 사용하세요.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import admin from 'firebase-admin';
import XLSX from 'xlsx';

const FROM_ALIASES = ['swagelok', 'code_from', 'swagelok_code', 'from', 'sw', '품번from'];
const TO_ALIASES = ['slok', 's-lok', 's_lok', 'code_to', 'slok_code', 'to', '품번to', 's lok'];

function normalizeSegment(seg) {
  const m = seg.match(/^0*(\d+)([A-Z]*)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return `${n}${m[2]}`;
  }
  return seg;
}

function insertLetterDigitHyphens(s) {
  let prev = '';
  let out = s;
  while (prev !== out) {
    prev = out;
    out = out.replace(/([A-Z])(\d)/g, '$1-$2');
    out = out.replace(/(\d)([A-Z])/g, '$1-$2');
  }
  return out;
}

function normalizeInstrumentCode(raw) {
  let s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  s = insertLetterDigitHyphens(s);
  const parts = s.split('-').filter(Boolean);
  return parts.map((p) => normalizeSegment(p)).join('-');
}

function mappingDocId(normalizedFrom) {
  return `SWAGELOK_${normalizedFrom.replace(/[/\\]/g, '_')}`;
}

function normHeader(h) {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

function pickColumn(headers, aliases) {
  const idx = headers.findIndex((h) => aliases.includes(normHeader(h)));
  return idx >= 0 ? idx : -1;
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const actorArg = argv.find((a) => a.startsWith('--actor='));
  const actor = actorArg ? actorArg.slice('--actor='.length) : 'catalog-import';
  const file = argv.find((a) => !a.startsWith('--'));
  return { dryRun, actor, file };
}

function sheetToRows(filePath) {
  const ext = filePath.toLowerCase();
  const wb = XLSX.readFile(filePath, { type: 'file', raw: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (data.length < 2) throw new Error('데이터가 없습니다. 헤더 + 최소 1행이 필요합니다.');
  const headers = data[0].map((c) => String(c));
  const fromI = pickColumn(headers, FROM_ALIASES);
  const toI = pickColumn(headers, TO_ALIASES);
  if (fromI < 0) {
    throw new Error(
      `Swagelok 열을 찾을 수 없습니다. 헤더에 다음 중 하나를 쓰세요: ${FROM_ALIASES.join(', ')}`
    );
  }
  if (toI < 0) {
    throw new Error(
      `S-LOK 열을 찾을 수 없습니다. 헤더에 다음 중 하나를 쓰세요: ${TO_ALIASES.join(', ')}`
    );
  }
  const nameFromI = pickColumn(headers, ['product_name_from', '제품명from', 'name_from']);
  const nameToI = pickColumn(headers, ['product_name_to', '제품명to', 'name_to']);
  const remarksI = pickColumn(headers, ['remarks', '비고', 'note']);

  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const from = String(row[fromI] ?? '').trim();
    const to = String(row[toI] ?? '').trim();
    if (!from && !to) continue;
    rows.push({
      code_from: from,
      code_to: to,
      product_name_from: nameFromI >= 0 ? String(row[nameFromI] ?? '').trim() : '',
      product_name_to: nameToI >= 0 ? String(row[nameToI] ?? '').trim() : '',
      remarks: remarksI >= 0 ? String(row[remarksI] ?? '').trim() : '',
    });
  }
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const { dryRun, actor, file } = parseArgs(argv);

  if (!file) {
    console.error('사용법: node scripts/importSubstituteMappingsFromSheet.mjs [--dry-run] [--actor=이름] <파일.xlsx|csv>');
    process.exit(1);
  }

  const filePath = resolve(file);
  if (!existsSync(filePath)) {
    console.error('파일 없음:', filePath);
    process.exit(1);
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath && !dryRun) {
    console.error('환경 변수 GOOGLE_APPLICATION_CREDENTIALS 에 서비스 계정 JSON 경로를 설정하세요.');
    process.exit(1);
  }

  const rows = sheetToRows(filePath);
  console.log(`파일: ${basename(filePath)} / 유효 행: ${rows.length}건${dryRun ? ' (dry-run)' : ''}`);

  let db;
  if (!dryRun) {
    const sa = JSON.parse(readFileSync(credPath, 'utf8'));
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    db = admin.firestore();
  }

  let ins = 0;
  let skip = 0;
  let err = 0;

  for (const row of rows) {
    if (!row.code_from || !row.code_to) {
      console.warn('건너뜀(빈 품번):', row);
      err++;
      continue;
    }
    const normFrom = normalizeInstrumentCode(row.code_from);
    const normTo = normalizeInstrumentCode(row.code_to);
    const id = mappingDocId(normFrom);
    const payload = {
      manufacturer_from: 'SWAGELOK',
      code_from: row.code_from,
      normalized_code_from: normFrom,
      product_name_from: row.product_name_from || '',
      manufacturer_to: 'SLOK',
      code_to: row.code_to,
      normalized_code_to: normTo,
      product_name_to: row.product_name_to || '',
      confidence: 70,
      source_type: 'catalog_inference',
      source_name: `Import: ${basename(filePath)}`,
      source_url: '',
      source_note: '카탈로그/표에서 일괄 가져옴. 검증 필요.',
      remarks: row.remarks || '',
      status: 'candidate',
      created_by: actor,
      updated_by: actor,
    };

    if (dryRun) {
      console.log('[dry-run]', id, normFrom, '->', normTo);
      ins++;
      continue;
    }

    const ref = db.collection('mappings').doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      skip++;
      continue;
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({
      ...payload,
      created_at: now,
      updated_at: now,
    });
    ins++;
  }

  console.log(`완료: 신규 ${ins}건, 스킵(기존) ${skip}건, 오류/빈행 ${err}건`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
