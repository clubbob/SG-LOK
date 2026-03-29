/**
 * UHP 재고 Firestore 시드 (`inventory/microWeldProducts`).
 * INVENTORY_SEED_VERSION을 올리면 클라이언트가 문서를 이 시드로 merge 덮어씁니다.
 */

import { createEmptyInventoryItem } from './itemFactory';
import type { InventoryProduct } from './types';
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

export const INVENTORY_SEED_VERSION = 10;

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

export const INITIAL_MICRO_WELD_PRODUCTS: InventoryProduct[] = [
  buildProductLine('Micro Elbow (HME)', '/inventory/micro-elbow-hme.png', 'HME'),
  HMRE_REDUCING_ELBOW,
  HMVE_PRODUCT,
  /** HMT Micro Tee — Part No. HMT-02·04·06·08·12 (HMVE 다음 표시) */
  buildProductLine('HMT', '/inventory/micro-elbow-hme.png', 'HMT'),
];

/** TBW / MFS 기본 제품 라인 제거 — 필요 시 제품등록에서 카테고리별로 추가 */
export const INITIAL_TUBE_BUTT_WELD_PRODUCTS: InventoryProduct[] = [];

export const INITIAL_METAL_FACE_SEAL_PRODUCTS: InventoryProduct[] = [];

export const INITIAL_UHP_INVENTORY_STATE: UhpInventorySlices<InventoryProduct> = {
  products: [...INITIAL_MICRO_WELD_PRODUCTS],
  tubeButtWeldProducts: [...INITIAL_TUBE_BUTT_WELD_PRODUCTS],
  metalFaceSealProducts: [...INITIAL_METAL_FACE_SEAL_PRODUCTS],
};

