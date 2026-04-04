import type { ManufacturerId } from './constants';

const INVALID_ID_CHARS = /[/\\]/g;

/**
 * 1:1(Swagelok 기준) 매핑이므로 문서 ID는 from 측 정규화 코드만 사용.
 * S-LOK 품번을 수정해도 문서 ID는 유지된다.
 */
export function buildMappingDocumentId(
  manufacturerFrom: ManufacturerId,
  normalizedFrom: string
): string {
  const safe = (x: string) => x.replace(INVALID_ID_CHARS, '_');
  return `${manufacturerFrom}_${safe(normalizedFrom)}`;
}
