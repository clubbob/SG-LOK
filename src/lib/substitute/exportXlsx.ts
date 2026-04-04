'use client';

import * as XLSX from 'xlsx';
import type { SubstituteMappingDoc } from './types';

function formatUpdatedAtForXlsx(ts: SubstituteMappingDoc['updated_at']): string {
  if (!ts) return '';
  try {
    const d =
      typeof (ts as { toDate?: () => Date }).toDate === 'function'
        ? (ts as { toDate: () => Date }).toDate()
        : new Date(
            ((ts as { seconds?: number }).seconds ?? 0) * 1000 +
              Math.floor(((ts as { nanoseconds?: number }).nanoseconds ?? 0) / 1e6)
          );
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * 대체품관리 화면 테이블과 동일한 열만 Excel로 보냅니다 (작업 열 제외).
 */
export function downloadSubstituteAdminTableXlsx(rows: SubstituteMappingDoc[], filename: string) {
  const data = rows.map((m) => ({
    'SWAGELOK 제품명': m.product_name_from ?? '',
    'SWAGELOK 제품코드': m.normalized_code_from ?? '',
    'S-LOK 제품명': m.product_name_to ?? '',
    'S-LOK 제품코드': m.normalized_code_to ?? '',
    비고: m.remarks ?? '',
    '최근 수정일': formatUpdatedAtForXlsx(m.updated_at),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'mappings');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
