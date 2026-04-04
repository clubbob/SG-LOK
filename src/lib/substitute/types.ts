import type { Timestamp } from 'firebase/firestore';
import type { ManufacturerId, MappingStatus, SourceType } from './constants';

/** Firestore mappings 문서 */
export interface SubstituteMapping {
  manufacturer_from: ManufacturerId;
  code_from: string;
  normalized_code_from: string;
  /** Swagelok 측 제품 참고 이미지 (https URL 또는 `/...` 정적 경로) */
  image_url_from?: string;
  product_name_from: string;
  manufacturer_to: ManufacturerId;
  code_to: string;
  normalized_code_to: string;
  product_name_to: string;
  confidence: number;
  source_type: SourceType | string;
  source_name: string;
  source_url: string;
  source_note: string;
  remarks: string;
  status: MappingStatus;
  updated_at: Timestamp | null;
  updated_by: string;
  created_at: Timestamp | null;
  created_by: string;
}

export interface SubstituteMappingHistoryEntry {
  mapping_id: string;
  before: Partial<SubstituteMapping> | Record<string, unknown>;
  after: Partial<SubstituteMapping> | Record<string, unknown>;
  changed_fields: string[];
  changed_at: Timestamp | null;
  changed_by: string;
}

export type SubstituteMappingDoc = SubstituteMapping & { id: string };

/** Swagelok 카탈로그(Tube Fitting) 파트 — Firestore `swagelok_catalog_parts` */
export interface SwagelokCatalogPart {
  manufacturer: string;
  /** 대분류: Tube Fitting */
  product_category: string;
  /** 표시용 제품명 */
  product_name: string;
  /** 주문번호(제품코드) */
  product_code: string;
  normalized_code: string;
  code_raw?: string;
  category_path?: string;
  ordering_token?: string;
  material_assumed?: string;
  catalog_import_profile?: string;
  source?: string;
  source_page_hint?: string;
  created_at?: Timestamp | null;
  updated_at?: Timestamp | null;
}

export type SwagelokCatalogPartDoc = SwagelokCatalogPart & { id: string };
