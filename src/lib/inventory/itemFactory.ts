import type { InventoryItem, InventoryVariant } from './types';

const VARIANT_SUFFIXES = ['SL-BA', 'SL-EP', 'SM-BA', 'SM-EP', 'DM-BA', 'DM-EP'] as const;

/** HME 계열과 동일한 6종 세부코드 접미사로 품목(아이템) 생성. 재고·이력은 0/빈 배열. */
export function createEmptyInventoryItem(
  codeBase: string,
  safetyStock: number,
  unit = 'EA'
): InventoryItem {
  const variants: InventoryVariant[] = VARIANT_SUFFIXES.map((suffix) => ({
    code: `${codeBase}-${suffix}`,
    hasQuoteRequest: false,
    currentStock: 0,
    unit,
  }));
  return {
    code: codeBase.trim(),
    variants,
    currentStock: 0,
    safetyStock,
    unit,
    inboundHistory: [],
    outboundHistory: [],
    adjustmentHistory: [],
    productionPlanHistory: [],
  };
}
