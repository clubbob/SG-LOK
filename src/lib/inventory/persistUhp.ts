import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { UhpInventoryState } from './types';

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
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );
}
