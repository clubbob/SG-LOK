import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { tabDefToFirestoreRow } from './uhpInventoryHelpers';
import type { UhpInventoryState } from './types';

/** 예전 시드에만 있던 기본 제품 라인 — 앱에서 제거했으나 Firestore에 남은 경우 정리 */
const STRIP_TUBE_DEFAULT_NAMES = new Set(['Tube Butt Weld Elbow (TBW)']);
const STRIP_METAL_DEFAULT_NAMES = new Set([
  'Metal Face Seal Elbow (MFS)',
  'Metal Face Seal Fitting (Sample)',
]);

export function dropRemovedDefaultCategoryProducts(state: UhpInventoryState): {
  next: UhpInventoryState;
  shouldPersistSlice: boolean;
} {
  const tube = state.tubeButtWeldProducts.filter((p) => !STRIP_TUBE_DEFAULT_NAMES.has(p.name));
  const metal = state.metalFaceSealProducts.filter((p) => !STRIP_METAL_DEFAULT_NAMES.has(p.name));
  const shouldPersistSlice =
    tube.length !== state.tubeButtWeldProducts.length ||
    metal.length !== state.metalFaceSealProducts.length;
  return {
    next: {
      ...state,
      tubeButtWeldProducts: tube,
      metalFaceSealProducts: metal,
    },
    shouldPersistSlice,
  };
}

export function sanitizeForFirestore<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForFirestore(item)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirestore(v)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

export async function persistUhpInventoryState(state: UhpInventoryState): Promise<void> {
  await setDoc(
    doc(db, 'inventory', 'microWeldProducts'),
    {
      products: sanitizeForFirestore(state.products),
      tubeButtWeldProducts: sanitizeForFirestore(state.tubeButtWeldProducts),
      metalFaceSealProducts: sanitizeForFirestore(state.metalFaceSealProducts),
      uhpCategoryTabs: sanitizeForFirestore(state.categoryTabs.map(tabDefToFirestoreRow)),
      customCategoryProducts: sanitizeForFirestore(state.customCategoryProducts),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );
}
