import type { SubstituteMapping } from './types';

/**
 * 1차: 표시용 비고 보조. 검색에는 사용하지 않음.
 * 추후 파서 필드가 생기면 여기서 문장을 조합.
 */
export function buildAutoRemarks(m: SubstituteMapping): string {
  const parts: string[] = [];
  if (m.normalized_code_from && m.normalized_code_to) {
    parts.push(`${m.normalized_code_from} → ${m.normalized_code_to}`);
  }
  if (m.source_note) {
    parts.push(m.source_note);
  }
  return parts.join(' | ');
}
