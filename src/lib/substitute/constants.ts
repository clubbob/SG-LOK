/** 내부 저장용 제조사 식별자 (UI는 Swagelok / S-LOK) */
export const MANUFACTURER = {
  SWAGELOK: 'SWAGELOK',
  SLOK: 'SLOK',
} as const;

export type ManufacturerId = (typeof MANUFACTURER)[keyof typeof MANUFACTURER];

export const MANUFACTURER_LABEL: Record<ManufacturerId, string> = {
  SWAGELOK: 'Swagelok',
  SLOK: 'S-LOK',
};

/** MVP: candidate / verified. reviewed 는 추후 UI·규칙 확장용 */
export const MAPPING_STATUS = {
  CANDIDATE: 'candidate',
  REVIEWED: 'reviewed',
  VERIFIED: 'verified',
} as const;

export type MappingStatus = (typeof MAPPING_STATUS)[keyof typeof MAPPING_STATUS];

export const MAPPING_STATUS_LABEL: Record<MappingStatus, string> = {
  candidate: '후보',
  reviewed: '검토완료',
  verified: '검증완료',
};

export const SOURCE_TYPE = {
  PUBLIC_CROSS_REFERENCE: 'public_cross_reference',
  CATALOG_INFERENCE: 'catalog_inference',
  MANUAL_VERIFIED: 'manual_verified',
} as const;

export type SourceType = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE];

/** confidence 권장값 (상수로만 사용) */
export const CONFIDENCE = {
  CATALOG_INFERENCE: 70,
  PUBLIC_CROSS_REFERENCE: 85,
  PUBLIC_AND_CATALOG: 95,
  MANUAL_VERIFIED: 100,
} as const;

export const COLLECTIONS = {
  MAPPINGS: 'mappings',
  MAPPING_HISTORY: 'mapping_history',
  /** PDF 등에서 추출한 Swagelok 주문번호·제품군(카탈로그 인덱스용) */
  SWAGELOK_CATALOG_PARTS: 'swagelok_catalog_parts',
  CODE_MATERIAL_MASTER: 'code_material_master',
  CODE_FAMILY_MASTER: 'code_family_master',
  CODE_SIZE_MASTER: 'code_size_master',
  CODE_OPTION_MASTER: 'code_option_master',
} as const;

/** Tube Fitting 1차 파서 카테고리 */
export const TUBE_FITTING_CATEGORY = 'Tube Fitting' as const;
