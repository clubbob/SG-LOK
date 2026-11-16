export const PRODUCTION_REQUEST_PRIORITY_MAX = 3;

export function clampProductionRequestPriority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const n = Math.round(value);
  if (n < 1) return 0;
  if (n > PRODUCTION_REQUEST_PRIORITY_MAX) return PRODUCTION_REQUEST_PRIORITY_MAX;
  return n;
}