import type {
  AdjustmentHistory,
  CombinedHistoryRow,
  InventoryItem,
  ProductionPlanHistory,
} from './types';

export function combinedHistoryRowMemo(row: CombinedHistoryRow): string {
  if (row.kind === 'adjustment') {
    return (row.raw as AdjustmentHistory).reason?.trim() || '-';
  }
  if (row.kind === 'production') {
    return (row.raw as ProductionPlanHistory).note?.trim() || '-';
  }
  return '-';
}

export function buildCombinedHistoryRows(
  historyTargetItem: InventoryItem | undefined
): CombinedHistoryRow[] {
  if (!historyTargetItem) return [];
  return [
    ...historyTargetItem.inboundHistory.map((history) => ({
      kind: 'inbound' as const,
      id: history.id,
      createdAt: history.createdAt,
      quantity: history.quantity,
      variantCode: history.variantCode,
      raw: history,
    })),
    ...historyTargetItem.outboundHistory.map((history) => ({
      kind: 'outbound' as const,
      id: history.id,
      createdAt: history.createdAt,
      quantity: history.quantity,
      variantCode: history.variantCode,
      raw: history,
    })),
    ...historyTargetItem.adjustmentHistory.map((history) => ({
      kind: 'adjustment' as const,
      id: history.id,
      createdAt: history.createdAt,
      quantity: history.delta,
      variantCode: history.variantCode,
      raw: history,
    })),
    ...(historyTargetItem.productionPlanHistory ?? []).map((history) => ({
      kind: 'production' as const,
      id: history.id,
      createdAt: history.updatedAt ?? history.createdAt,
      quantity: history.plannedQuantity,
      variantCode: history.variantCode,
      dueDate: history.dueDate,
      raw: history,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
