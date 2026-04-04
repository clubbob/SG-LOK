import swagelokImageOverrides from '@/data/swagelokImageOverrides.json';
import type { SubstituteMappingDoc } from './types';

/** Swagelok 온라인 카탈로그(영문) 제품 상세 — 품번은 정규화(대문자·하이픈) 기준 */
export function buildSwagelokEnProductPageUrl(normalizedCode: string): string {
  return `https://products.swagelok.com/en/p/${encodeURIComponent(normalizedCode.trim().toUpperCase())}`;
}

function isAllowedImageUrl(u: string): boolean {
  const t = u.trim();
  if (!t) return false;
  if (t.startsWith('/')) return true;
  try {
    const x = new URL(t);
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 대체품찾기 화면용 Swagelok 참고 이미지 URL.
 * 우선순위: 매핑 문서 `image_url_from` → `swagelokImageOverrides.json` (정규화 품번 키)
 */
export function resolveSwagelokImageUrl(
  normalizedCode: string,
  rows: SubstituteMappingDoc[]
): string | null {
  for (const r of rows) {
    const u = r.image_url_from?.trim();
    if (u && isAllowedImageUrl(u)) return u;
  }
  const map = swagelokImageOverrides as Record<string, string>;
  const o = map[normalizedCode]?.trim();
  if (o && isAllowedImageUrl(o)) return o;
  return null;
}
