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

export const INVENTORY_SEED_VERSION = 17;

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

/** HLE Long Elbow — 02 규격 미사용, 04·06·08·12 만 */
const HLE_TUBE_SIZE_ROWS: { size: string; safetyStock: number }[] = [
  { size: '04', safetyStock: 60 },
  { size: '06', safetyStock: 60 },
  { size: '08', safetyStock: 70 },
  { size: '12', safetyStock: 45 },
];

const LONG_ELBOW_HLE_LINE_NAME = 'Long Elbow (HLE)';

/**
 * Tube Butt Weld 카테고리 기본 제품 라인 (Long Elbow HLE는 별도 탭이 아님).
 */
export const INITIAL_TUBE_BUTT_WELD_PRODUCTS: InventoryProduct[] = [
  {
    name: LONG_ELBOW_HLE_LINE_NAME,
    imageSrc: '/inventory/micro-elbow-hme.png',
    items: HLE_TUBE_SIZE_ROWS.map(({ size, safetyStock }) =>
      createEmptyInventoryItem(`HLE-${size}`, safetyStock)
    ),
  },
];

/**
 * Metal Face Seal 기본 라인
 * - 요청 반영: Sample 라인 제거
 * - HMGS Micro Gland S 라인 기본 제공
 */
export const INITIAL_METAL_FACE_SEAL_PRODUCTS: InventoryProduct[] = [
  buildProductLine('Micro Gland S (HMGS)', '/inventory/micro-elbow-hme.png', 'HMGS'),
];

/**
 * Long Elbow(HLE) 제품 라인에서 품목 `HLE-02` 를 제거합니다(레거시 Firestore 정리).
 */
export function stripHle02ItemFromLongElbowLine(
  tubeButtWeldProducts: InventoryProduct[]
): { next: InventoryProduct[]; changed: boolean } {
  let changed = false;
  const next = tubeButtWeldProducts.map((p) => {
    if (p.name !== LONG_ELBOW_HLE_LINE_NAME) return p;
    const filtered = p.items.filter((item) => item.code.trim().toUpperCase() !== 'HLE-02');
    if (filtered.length === p.items.length) return p;
    changed = true;
    return { ...p, items: filtered };
  });
  return { next, changed };
}

/**
 * 시드에 정의된 제품 라인(제품명 기준)이 없으면 끝에 추가하고,
 * 같은 이름이 있으면 시드에만 있는 품목(code)만 붙입니다.
 * `inventorySeedVersion` 갱신 시 Firestore의 기존 제품을 통째로 덮어쓰지 않기 위함.
 */
export function ensureSeedProductLinesInCategory(
  existing: InventoryProduct[],
  seedLines: InventoryProduct[]
): { next: InventoryProduct[]; changed: boolean } {
  if (seedLines.length === 0) {
    return { next: existing, changed: false };
  }
  let changed = false;
  const next: InventoryProduct[] = existing.map(
    (p) => JSON.parse(JSON.stringify(p)) as InventoryProduct
  );
  const indexByName = new Map(next.map((p, i) => [p.name, i] as const));
  for (const seed of seedLines) {
    const seedClone = JSON.parse(JSON.stringify(seed)) as InventoryProduct;
    const idx = indexByName.get(seedClone.name);
    if (idx === undefined) {
      next.push(seedClone);
      indexByName.set(seedClone.name, next.length - 1);
      changed = true;
      continue;
    }
    const line = next[idx];
    const codes = new Set(line.items.map((i) => i.code));
    const missing = seedClone.items.filter((i) => !codes.has(i.code));
    if (missing.length > 0) {
      const clones = missing.map((i) => JSON.parse(JSON.stringify(i)) as InventoryItem);
      next[idx] = { ...line, items: [...line.items, ...clones] };
      changed = true;
    }
  }
  return { next, changed };
}

/**
 * 예전 Firestore 필드 `longElbowProducts` 를 `tubeButtWeldProducts` 로 합칩니다.
 * 동일 제품명이 있으면 품목(code)만 보강합니다.
 */
export function mergeLegacyLongElbowIntoTubeButtWeld(
  tubeButtWeldProducts: InventoryProduct[],
  longElbowProducts?: InventoryProduct[] | null
): { next: InventoryProduct[]; changed: boolean } {
  if (!Array.isArray(longElbowProducts) || longElbowProducts.length === 0) {
    return { next: tubeButtWeldProducts, changed: false };
  }
  let changed = false;
  const next: InventoryProduct[] = tubeButtWeldProducts.map(
    (p) => JSON.parse(JSON.stringify(p)) as InventoryProduct
  );
  for (const leg of longElbowProducts) {
    const legClone = JSON.parse(JSON.stringify(leg)) as InventoryProduct;
    const idx = next.findIndex((p) => p.name === legClone.name);
    if (idx === -1) {
      next.push(legClone);
      changed = true;
      continue;
    }
    const existing = next[idx];
    const codes = new Set(existing.items.map((i) => i.code));
    const missing = legClone.items.filter((i) => !codes.has(i.code));
    if (missing.length > 0) {
      next[idx] = { ...existing, items: [...existing.items, ...missing] };
      changed = true;
    }
  }
  return { next, changed };
}

export const INITIAL_UHP_INVENTORY_STATE: UhpInventorySlices<InventoryProduct> = {
  products: [...INITIAL_MICRO_WELD_PRODUCTS],
  tubeButtWeldProducts: [...INITIAL_TUBE_BUTT_WELD_PRODUCTS],
  metalFaceSealProducts: [...INITIAL_METAL_FACE_SEAL_PRODUCTS],
};

