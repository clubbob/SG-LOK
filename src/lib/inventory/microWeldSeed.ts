/**
 * UHP 재고 Firestore 시드 (`inventory/microWeldProducts`).
 * INVENTORY_SEED_VERSION을 올리면 클라이언트가 문서를 이 시드로 merge 덮어씁니다.
 */

import { createEmptyInventoryItem } from './itemFactory';
import type { InventoryItem, InventoryProduct } from './types';
import type { UhpInventorySlices } from './uhpInventoryHelpers';

/** HME와 동일 규격(02·04·06·08·12) + 안전재고 */
const DEFAULT_SIZE_ROWS: { size: string; safetyStock: number }[] = [
  { size: '02', safetyStock: 80 },
  { size: '04', safetyStock: 60 },
  { size: '06', safetyStock: 60 },
  { size: '08', safetyStock: 70 },
  { size: '12', safetyStock: 45 },
];

function buildProductLine(
  name: string,
  imageSrc: string,
  codePrefix: string
): InventoryProduct {
  return {
    name,
    imageSrc,
    items: DEFAULT_SIZE_ROWS.map(({ size, safetyStock }) =>
      createEmptyInventoryItem(`${codePrefix}-${size}`, safetyStock)
    ),
  };
}

export const INVENTORY_SEED_VERSION = 11;

/** HMVE — 도면 Part No. HMVE-04·06·08 계열 */
const HMVE_PRODUCT: InventoryProduct = {
  name: 'HMVE',
  imageSrc: '/inventory/micro-elbow-hme.png',
  items: [
    createEmptyInventoryItem('HMVE-04', 60),
    createEmptyInventoryItem('HMVE-06', 60),
    createEmptyInventoryItem('HMVE-08', 70),
  ],
};

/** HMRE Micro Reducing Elbow 90° — 도면 Part No. 기준 (세부 variant는 itemFactory 6종 접미사) */
const HMRE_REDUCING_ELBOW: InventoryProduct = {
  name: 'Micro Reducing Elbow 90° (HMRE)',
  imageSrc: '/inventory/micro-elbow-hme.png',
  items: [
    createEmptyInventoryItem('HMRE-0402', 60),
    createEmptyInventoryItem('HMRE-0604', 60),
    createEmptyInventoryItem('HMRE-0804', 70),
    createEmptyInventoryItem('HMRE-0806', 60),
  ],
};

/** Micro Reducing Tee (HMRT) — 도면 Part No. HMRT-0402·0604·0804·0806 (세부 variant 6종은 itemFactory 접미사) */
const HMRT_MICRO_REDUCING_TEE: InventoryProduct = {
  name: 'Micro Reducing Tee (HMRT)',
  imageSrc: '/inventory/micro-elbow-hme.png',
  items: [
    createEmptyInventoryItem('HMRT-0402', 60),
    createEmptyInventoryItem('HMRT-0604', 60),
    createEmptyInventoryItem('HMRT-0804', 70),
    createEmptyInventoryItem('HMRT-0806', 60),
  ],
};

/** 동일 제품 라인으로 보는 표시명(과거·도면 표기 차이) */
const HMRT_LINE_ALIASES = new Set([
  'HMRT',
  'HMRT Micro Reducing Tee',
  'Micro Reducing Tee (HMRT)',
]);

const HMRT_LINE_SHORT_LEGACY = 'HMRT';
const HMRT_LINE_DISPLAY_NAME = HMRT_MICRO_REDUCING_TEE.name;

function isHmrtMicroReducingTeeLine(p: InventoryProduct): boolean {
  return HMRT_LINE_ALIASES.has(p.name);
}

/**
 * HMRT 계열 제품 라인에 도면 Part No. 4종 품목을 채웁니다.
 * 제품명이 짧게 HMRT 만 쓰인 경우 표시명을 Micro Reducing Tee (HMRT) 로 맞춥니다.
 */
export function mergeMissingHmrtItemsFromSeed(products: InventoryProduct[]): {
  next: InventoryProduct[];
  changed: boolean;
} {
  const seedItems: InventoryItem[] = HMRT_MICRO_REDUCING_TEE.items.map((item) =>
    createEmptyInventoryItem(item.code, item.safetyStock, item.unit)
  );
  let changed = false;
  const next = products.map((p) => {
    if (!isHmrtMicroReducingTeeLine(p)) return p;
    const renamedFromShort = p.name === HMRT_LINE_SHORT_LEGACY;
    const base = renamedFromShort ? { ...p, name: HMRT_LINE_DISPLAY_NAME } : p;
    const existingCodes = new Set(base.items.map((i) => i.code));
    const missing = seedItems.filter((si) => !existingCodes.has(si.code));
    if (missing.length === 0 && !renamedFromShort) return p;
    changed = true;
    const clones = missing.map((item) => JSON.parse(JSON.stringify(item)) as InventoryItem);
    return { ...base, items: [...base.items, ...clones] };
  });
  return { next, changed };
}

/** HMTB Micro Tribow — 도면 Part No. HMTB-04·06·08 (HMVE와 동일 안전재고·6종 variant) */
const HMTB_PRODUCT: InventoryProduct = {
  name: 'HMTB Micro Tribow',
  imageSrc: '/inventory/micro-elbow-hme.png',
  items: [
    createEmptyInventoryItem('HMTB-04', 60),
    createEmptyInventoryItem('HMTB-06', 60),
    createEmptyInventoryItem('HMTB-08', 70),
  ],
};

const HMTB_LINE_SHORT_LEGACY = 'HMTB';
const HMTB_LINE_DISPLAY_NAME = HMTB_PRODUCT.name;

const HMTB_LINE_ALIASES = new Set([
  HMTB_LINE_SHORT_LEGACY,
  HMTB_LINE_DISPLAY_NAME,
  'Micro Tribow (HMTB)',
]);

/**
 * HMTB Micro Tribow 라인(구 이름 HMTB·Micro Tribow (HMTB) 포함)에 도면 Part No. 3종 품목을 채웁니다.
 * 제품명이 짧게 HMTB 만 쓰인 경우 표시명을 HMTB Micro Tribow 로 맞춥니다.
 */
export function mergeMissingHmtbItemsFromSeed(products: InventoryProduct[]): {
  next: InventoryProduct[];
  changed: boolean;
} {
  const seedItems: InventoryItem[] = HMTB_PRODUCT.items.map((item) =>
    createEmptyInventoryItem(item.code, item.safetyStock, item.unit)
  );
  let changed = false;
  const next = products.map((p) => {
    if (!HMTB_LINE_ALIASES.has(p.name)) return p;
    const renamedFromShort = p.name === HMTB_LINE_SHORT_LEGACY;
    const base = renamedFromShort ? { ...p, name: HMTB_LINE_DISPLAY_NAME } : p;
    const existingCodes = new Set(base.items.map((i) => i.code));
    const missing = seedItems.filter((si) => !existingCodes.has(si.code));
    if (missing.length === 0 && !renamedFromShort) return p;
    changed = true;
    const clones = missing.map((item) => JSON.parse(JSON.stringify(item)) as InventoryItem);
    return { ...base, items: [...base.items, ...clones] };
  });
  return { next, changed };
}

/** HMC — Part No. HMC-04·06·08 (HMVE·HMTB와 동일 안전재고·6종 variant) */
const HMC_PRODUCT: InventoryProduct = {
  name: 'HMC',
  imageSrc: '/inventory/micro-elbow-hme.png',
  items: [
    createEmptyInventoryItem('HMC-04', 60),
    createEmptyInventoryItem('HMC-06', 60),
    createEmptyInventoryItem('HMC-08', 70),
  ],
};

const HMC_LINE_ALIASES = new Set(['HMC']);

function isHmcProductLineName(name: string): boolean {
  const n = name.trim();
  if (HMC_LINE_ALIASES.has(n)) return true;
  if (n.toUpperCase() === 'HMC') return true;
  return /\(HMC\)\s*$/i.test(n);
}

/**
 * HMC 제품 라인에 HMC-04·06·08 품목을 채웁니다.
 * 제품명이 HMC·(HMC)로 끝나는 표기 등도 동일 라인으로 봅니다.
 * 해당 라인이 없으면 HMC 제품 라인을 새로 붙입니다.
 */
export function mergeMissingHmcItemsFromSeed(products: InventoryProduct[]): {
  next: InventoryProduct[];
  changed: boolean;
} {
  const seedItems: InventoryItem[] = HMC_PRODUCT.items.map((item) =>
    createEmptyInventoryItem(item.code, item.safetyStock, item.unit)
  );

  if (!products.some((p) => isHmcProductLineName(p.name))) {
    const items = seedItems.map((item) => JSON.parse(JSON.stringify(item)) as InventoryItem);
    const line: InventoryProduct = {
      name: HMC_PRODUCT.name,
      imageSrc: HMC_PRODUCT.imageSrc,
      items,
    };
    return { next: [...products, line], changed: true };
  }

  let changed = false;
  const next = products.map((p) => {
    if (!isHmcProductLineName(p.name)) return p;
    const existingCodes = new Set(p.items.map((i) => i.code));
    const missing = seedItems.filter((si) => !existingCodes.has(si.code));
    if (missing.length === 0) return p;
    changed = true;
    const clones = missing.map((item) => JSON.parse(JSON.stringify(item)) as InventoryItem);
    return { ...p, items: [...p.items, ...clones] };
  });
  return { next, changed };
}

export const INITIAL_MICRO_WELD_PRODUCTS: InventoryProduct[] = [
  buildProductLine('Micro Elbow (HME)', '/inventory/micro-elbow-hme.png', 'HME'),
  HMRE_REDUCING_ELBOW,
  HMRT_MICRO_REDUCING_TEE,
  HMVE_PRODUCT,
  /** HMT Micro Tee — Part No. HMT-02·04·06·08·12 (HMVE 다음 표시) */
  buildProductLine('HMT', '/inventory/micro-elbow-hme.png', 'HMT'),
  HMTB_PRODUCT,
  HMC_PRODUCT,
];

/** TBW / MFS 기본 제품 라인 제거 — 필요 시 제품등록에서 카테고리별로 추가 */
export const INITIAL_TUBE_BUTT_WELD_PRODUCTS: InventoryProduct[] = [];

export const INITIAL_METAL_FACE_SEAL_PRODUCTS: InventoryProduct[] = [];

export const INITIAL_UHP_INVENTORY_STATE: UhpInventorySlices<InventoryProduct> = {
  products: [...INITIAL_MICRO_WELD_PRODUCTS],
  tubeButtWeldProducts: [...INITIAL_TUBE_BUTT_WELD_PRODUCTS],
  metalFaceSealProducts: [...INITIAL_METAL_FACE_SEAL_PRODUCTS],
};

