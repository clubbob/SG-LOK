/**
 * 튜브 피팅 등 품번용 정규화: 대문자, 공백 제거, 하이픈 정리,
 * 문자-숫자 경계 하이픈 보정, 숫자 세그먼트의 선행 0 정리(04N→4N 등).
 */
function normalizeSegment(seg: string): string {
  const m = seg.match(/^0*(\d+)([A-Z]*)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return `${n}${m[2]}`;
  }
  return seg;
}

const METRIC_M_SENTINEL = '\uE000';

function insertLetterDigitHyphens(s: string): string {
  // Swagelok metric body: 2M0, 10M0 — M between digits is not a letter boundary
  let out = s.replace(/(\d)M(\d)/g, `$1${METRIC_M_SENTINEL}$2`);
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/([A-Z])(\d)/g, '$1-$2');
    out = out.replace(/(\d)([A-Z])/g, '$1-$2');
  }
  return out.replace(new RegExp(METRIC_M_SENTINEL, 'g'), 'M');
}

export function normalizeInstrumentCode(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/\s+/g, '');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  // 하이픈이 이미 포함된 품번(예: 6LV-4MW-3)은 원형을 우선 보존하고,
  // 하이픈 없는 입력(예: SS40014)에만 경계 보정 규칙을 적용한다.
  if (!s.includes('-')) {
    s = insertLetterDigitHyphens(s);
  }
  const parts = s.split('-').filter(Boolean);
  return parts.map((p) => normalizeSegment(p)).join('-');
}

/**
 * DB에 저장된 키와 검색 표기 차이 보정 (예: SS-400-14 ↔ SS-400-1-4).
 * Firestore `in` 쿼리 상한(10) 이내만 반환.
 */
export function expandAlternateSearchKeys(normalized: string): string[] {
  const keys = new Set<string>([normalized]);
  const parts = normalized.split('-').filter(Boolean);

  if (parts.length >= 4) {
    const p3 = parts[parts.length - 3];
    const p2 = parts[parts.length - 2];
    const p1 = parts[parts.length - 1];
    if (/^\d{3}$/.test(p3) && /^\d$/.test(p2) && /^\d$/.test(p1)) {
      keys.add([...parts.slice(0, -3), p3, p2 + p1].join('-'));
    }
  }
  if (parts.length >= 3) {
    const prev = parts[parts.length - 2];
    const last = parts[parts.length - 1];
    if (/^\d{3}$/.test(prev) && /^\d{2}$/.test(last)) {
      keys.add([...parts.slice(0, -1), last[0], last[1]].join('-'));
    }
  }
  return [...keys].slice(0, 10);
}
