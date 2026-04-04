/**
 * Swagelok Tube Fittings 카탈로그 PDF(MS-01-140 계열) 텍스트에서 주문번호·섹션 제목을 추출해
 * Firestore `swagelok_catalog_parts` 에 저장합니다.
 *
 * 한계: PDF 표가 줄바꿈으로 깨져 있어 품번은 규칙 추출이며, 접두(SS-/B- 등)는 문맥 추정입니다.
 * `Swagelok 코드 분해 규칙 표준화안.docx`는 정규화 로직은 src/lib/substitute/codeNormalize.ts 와 맞추고,
 * 본 스크립트의 normalized_code 도 동일 함수로 계산합니다.
 *
 * 준비:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="...\serviceAccount.json"
 *
 * 사용:
 *   node scripts/importSwagelokCatalogPdf.mjs [--dry-run] [--pdf=경로] [--replace] [--all-materials]
 *
 * 기본: **316 Stainless Steel (주문번호 SS- 접두)만** Firestore에 적재합니다. 황동(B-)·기타 합금 품목은 제외합니다.
 * **접미 변형 제거**: SS-400-1-4 가 있으면 SS-400-1-4-RT 등 5세그먼트 이상·앞 4세그먼트 동일 행은 시드/적재에서 빠집니다.
 * --all-materials  SS 외 재질 추출분까지 포함(이전 동작).
 *
 * 인증(택1):
 *   GOOGLE_APPLICATION_CREDENTIALS=서비스계정.json 경로
 *   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' (한 줄 JSON)
 *
 * --replace  기존 동일 normalized_code 문서를 덮어씀(없으면 스킵만)
 * --export-json=경로  Firestore 없이 JSON만 출력(관리자 시드용). SS 필터·PDF 파싱 동일.
 *
 * 기본 PDF: public/catalogs/Swagelok-Tube-Fittings.pdf
 */

/** 앱 `TUBE_FITTING_CATEGORY` 와 동일 */
const PRODUCT_CATEGORY_TUBE_FITTING = 'Tube Fitting';

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { createRequire } from 'module';
import admin from 'firebase-admin';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const COLLECTION = 'swagelok_catalog_parts';
const DEFAULT_PDF = resolve('public/catalogs/Swagelok-Tube-Fittings.pdf');

/** 카탈로그 목차·본문에 자주 나오는 섹션 제목(제품군 라벨용) */
const SECTION_TITLE_RE =
  /^(Straight Fittings|Male Connectors|Female Connectors|Unions|Union|Reducers|Reducer|Tees|Tee|Elbows|Elbow|Crosses|Cross|Caps and Plugs|Cap|Plug|Weld Connectors|Port Connectors|AN Bulkhead|AN Fitting|Bulkhead|Positionable|Female Run|Male Branch|Gaugeable Tube Fittings|Tube Fittings|Ordering Numbers|Dimensions|Features|Materials|Contents)$/i;

function normalizeSegment(seg) {
  const m = seg.match(/^0*(\d+)([A-Z]*)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return `${n}${m[2]}`;
  }
  return seg;
}

const METRIC_M_SENTINEL = '\uE000';

function insertLetterDigitHyphens(s) {
  let out = s.replace(/(\d)M(\d)/g, `$1${METRIC_M_SENTINEL}$2`);
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/([A-Z])(\d)/g, '$1-$2');
    out = out.replace(/(\d)([A-Z])/g, '$1-$2');
  }
  return out.replace(new RegExp(METRIC_M_SENTINEL, 'g'), 'M');
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

/** 400, 1210, 10M0 등 몸체 코드 */
const BODY = '(?:\\d{3,4}[A-Z]?|\\d{1,2}M\\d+)';
/** 접미 주문번호: -400-1-4RT, -6M0-1-4RS */
const SUFFIX_TOKEN_RE = new RegExp(
  `(?<![A-Za-z0-9/])-(${BODY}-\\d+[A-Z]?-\\d+[A-Za-z0-9.-]*)(?![A-Za-z0-9])`,
  'g'
);
/** 완전 품번: SS-400-1-4, B-600-1-6, 6MO-400-1-4 */
const FULL_TOKEN_RE =
  /\b([A-Z]{1,6}[A-Z0-9]*-\d{3,4}[A-Z]?-\d+[A-Z]?-\d+[A-Za-z0-9.-]*)\b/g;

function docIdForNormalized(norm) {
  const safe = norm.replace(/[/\\]/g, '_');
  return `SWAGELOK_CAT_${safe}`.slice(0, 1400);
}

function recentContextBrass(lines, fromIdx, window = 25) {
  const start = Math.max(0, fromIdx - window);
  const chunk = lines.slice(start, fromIdx + 1).join('\n').toLowerCase();
  if (/\bbrass\b|황동/.test(chunk)) return true;
  if (/\b316\b|\bstainless\b|스테인리스/.test(chunk)) return false;
  return false;
}

function reconstructCode(token, assumeBrass) {
  const t = token.trim();
  if (/^[A-Z]{1,6}/.test(t)) return t;
  if (t.startsWith('-')) {
    const core = t.slice(1);
    if (assumeBrass) return `B-${core}`;
    return `SS-${core}`;
  }
  return t;
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const replace = argv.includes('--replace');
  const allMaterials = argv.includes('--all-materials');
  const pdfArg = argv.find((a) => a.startsWith('--pdf='));
  const pdfPath = pdfArg ? pdfArg.slice('--pdf='.length) : null;
  const exportArg = argv.find((a) => a.startsWith('--export-json='));
  const exportJsonPath = exportArg ? exportArg.slice('--export-json='.length) : null;
  return { dryRun, replace, pdfPath, allMaterials, exportJsonPath };
}

function rowForDb(categoryPath, codeRaw, norm, token, material, pageHint) {
  return {
    normalized_code: norm,
    code_raw: codeRaw,
    ordering_token: token,
    material_assumed: material,
    category_path: categoryPath,
    product_category: PRODUCT_CATEGORY_TUBE_FITTING,
    product_code: codeRaw,
    product_name: `Swagelok · ${PRODUCT_CATEGORY_TUBE_FITTING} · ${categoryPath}`,
    source_page_hint: pageHint || '',
  };
}

/** SS-316 계열 주문번호만 (카탈로그 표기 기준). B·6MO 등 제외 */
function filterStainlessSsOnly(rows) {
  return rows.filter(
    (r) => r.material_assumed === 'SS' && /^SS-/i.test(String(r.code_raw).trim())
  );
}

/**
 * 앞 4세그먼트가 다른 행과 정확히 일치하는 5세그먼트 이상 품번은 제거 (접미 옵션 RT/RS/BQ 등).
 * 예: SS-400-1-4 가 있으면 SS-400-1-4-RT, SS-400-1-4-BQ 는 DB/시드에 넣지 않음.
 */
function pruneSuffixVariantRows(rows) {
  const codeSet = new Set(rows.map((r) => r.normalized_code));
  return rows.filter((r) => {
    const parts = r.normalized_code.split('-').filter(Boolean);
    if (parts.length <= 4) return true;
    const base = parts.slice(0, 4).join('-');
    return !codeSet.has(base);
  });
}

function seedPayloadFromRows(rows, sourceFileLabel, importProfile) {
  return rows.map((r) => ({
    id: docIdForNormalized(r.normalized_code),
    manufacturer: 'SWAGELOK',
    ...r,
    source: `pdf:${sourceFileLabel}`,
    catalog_import_profile: importProfile,
  }));
}

function initFirebaseAdmin() {
  if (admin.apps.length) return;
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    const sa = JSON.parse(inline);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    return;
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath || !existsSync(credPath)) {
    throw new Error(
      'Missing Firebase Admin credentials. Set GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON) or FIREBASE_SERVICE_ACCOUNT_JSON (inline JSON string).'
    );
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

function extractCatalog(text) {
  const lines = text.split(/\r?\n/);
  /** @type {Map<string, ReturnType<typeof rowForDb>>} */
  const byNorm = new Map();
  let categoryPath = 'Tube Fittings (general)';
  let pageHint = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (/^--\s*\d+\s+of\s+\d+\s+--$/.test(t)) {
      pageHint = t;
      continue;
    }

    if (t.length >= 4 && t.length < 72 && SECTION_TITLE_RE.test(t)) {
      categoryPath = t;
      continue;
    }

    const assumeBrass = recentContextBrass(lines, i);

    let m;
    SUFFIX_TOKEN_RE.lastIndex = 0;
    while ((m = SUFFIX_TOKEN_RE.exec(line)) !== null) {
      const token = m[1].startsWith('-') ? m[1] : `-${m[1]}`;
      const codeRaw = reconstructCode(token, assumeBrass);
      const norm = normalizeInstrumentCode(codeRaw);
      if (norm.length < 6) continue;
      const mat = assumeBrass ? 'B' : 'SS';
      const next = rowForDb(categoryPath, codeRaw, norm, token, mat, pageHint);
      const prev = byNorm.get(norm);
      if (!prev || categoryPath.length > (prev.category_path?.length ?? 0)) {
        byNorm.set(norm, next);
      }
    }

    FULL_TOKEN_RE.lastIndex = 0;
    while ((m = FULL_TOKEN_RE.exec(line)) !== null) {
      const codeRaw = m[1];
      const norm = normalizeInstrumentCode(codeRaw);
      if (norm.length < 6) continue;
      const mat = /^B-/i.test(codeRaw) ? 'B' : /^SS-/i.test(codeRaw) ? 'SS' : 'other';
      const next = rowForDb(categoryPath, codeRaw, norm, codeRaw, mat, pageHint);
      const prev = byNorm.get(norm);
      if (!prev || categoryPath.length > (prev.category_path?.length ?? 0)) {
        byNorm.set(norm, next);
      }
    }
  }

  return [...byNorm.values()];
}

async function main() {
  const argv = process.argv.slice(2);
  const { dryRun, replace, pdfPath, allMaterials, exportJsonPath } = parseArgs(argv);
  const pdfFile = resolve(pdfPath || DEFAULT_PDF);

  if (!existsSync(pdfFile)) {
    console.error('PDF 없음:', pdfFile);
    process.exit(1);
  }

  const buf = readFileSync(pdfFile);
  const parsed = await pdfParse(buf);
  let rows = extractCatalog(parsed.text);
  const extractedTotal = rows.length;
  if (!allMaterials) {
    rows = filterStainlessSsOnly(rows);
  }
  const beforePrune = rows.length;
  rows = pruneSuffixVariantRows(rows);
  const pruned = beforePrune - rows.length;
  console.log(
    `추출 행: ${rows.length}건 · PDF: ${basename(pdfFile)}` +
      (allMaterials ? '' : ` (SS만, 병합 ${extractedTotal}건 중)`) +
      (pruned > 0 ? ` · 접미 변형 제거 ${pruned}건` : '')
  );

  if (exportJsonPath) {
    const out = resolve(exportJsonPath);
    const profile = allMaterials ? 'all_materials' : 'stainless_ss_only';
    const payload = seedPayloadFromRows(rows, basename(pdfFile), profile);
    writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`시드 JSON 저장: ${out} (${payload.length}건)`);
    return;
  }

  if (dryRun) {
    console.log(rows.slice(0, 15).map((r) => `${r.normalized_code} ← ${r.product_code}`).join('\n'));
    if (rows.length > 15) console.log(`… 외 ${rows.length - 15}건`);
    return;
  }

  initFirebaseAdmin();
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const source = `pdf:${basename(pdfFile)}`;
  const importProfile = allMaterials ? 'all_materials' : 'stainless_ss_only';

  let written = 0;
  let skipped = 0;
  const batchSize = 400;
  const getChunk = 10;

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const refs = chunk.map((r) => ({
      r,
      ref: db.collection(COLLECTION).doc(docIdForNormalized(r.normalized_code)),
    }));
    /** @type {FirebaseFirestore.DocumentSnapshot[]} */
    const snaps = [];
    for (let k = 0; k < refs.length; k += getChunk) {
      const slice = refs.slice(k, k + getChunk);
      const got = await db.getAll(...slice.map((x) => x.ref));
      snaps.push(...got);
    }

    const batch = db.batch();
    let ops = 0;
    for (let j = 0; j < refs.length; j++) {
      const { r, ref } = refs[j];
      const snap = snaps[j];
      if (snap.exists && !replace) {
        skipped++;
        continue;
      }
      batch.set(
        ref,
        {
          manufacturer: 'SWAGELOK',
          code_raw: r.code_raw,
          normalized_code: r.normalized_code,
          ordering_token: r.ordering_token,
          material_assumed: r.material_assumed,
          catalog_import_profile: importProfile,
          product_category: r.product_category,
          product_code: r.product_code,
          product_name: r.product_name,
          category_path: r.category_path,
          source_page_hint: r.source_page_hint || '',
          source,
          updated_at: now,
          ...(snap.exists ? {} : { created_at: now }),
        },
        { merge: true }
      );
      ops++;
      written++;
    }
    if (ops > 0) await batch.commit();
  }

  console.log(`Firestore ${COLLECTION}: 쓰기(merge) ${written}건, 스킵(기존·no replace) ${skipped}건`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
