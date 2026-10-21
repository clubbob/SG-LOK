import { Timestamp } from 'firebase/firestore';

/** Firestore는 undefined를 허용하지 않음 — 저장 직전에 제거 */
export function sanitizeForFirestore<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (value === null) {
    return value;
  }
  if (value instanceof Date || value instanceof Timestamp) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForFirestore(item)) as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) continue;
      out[key] = sanitizeForFirestore(nested);
    }
    return out as T;
  }
  return value;
}
