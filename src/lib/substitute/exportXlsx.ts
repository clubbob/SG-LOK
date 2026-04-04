'use client';

import * as XLSX from 'xlsx';
import { MAPPING_STATUS_LABEL, MANUFACTURER_LABEL } from './constants';
import type { SubstituteMappingDoc } from './types';

function rowForSheet(m: SubstituteMappingDoc) {
  return {
    문서ID: m.id,
    From제조사: MANUFACTURER_LABEL[m.manufacturer_from],
    From코드_raw: m.code_from,
    From코드_normalized: m.normalized_code_from,
    From이미지URL: m.image_url_from ?? '',
    From제품명: m.product_name_from,
    To제조사: MANUFACTURER_LABEL[m.manufacturer_to],
    To코드_raw: m.code_to,
    To코드_normalized: m.normalized_code_to,
    To제품명: m.product_name_to,
    confidence: m.confidence,
    source_type: m.source_type,
    source_name: m.source_name,
    source_url: m.source_url,
    source_note: m.source_note,
    remarks: m.remarks,
    status: m.status,
    status_label: MAPPING_STATUS_LABEL[m.status] ?? m.status,
    updated_by: m.updated_by,
    created_by: m.created_by,
  };
}

export function downloadMappingsAsXlsx(rows: SubstituteMappingDoc[], filename: string) {
  const data = rows.map(rowForSheet);
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'mappings');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
