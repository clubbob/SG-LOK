import type { UhpInventorySlices } from './uhpInventoryHelpers';

export type InboundHistory = {
  id: string;
  quantity: number;
  createdAt: string;
  variantCode?: string;
};

export type OutboundHistory = {
  id: string;
  quantity: number;
  createdAt: string;
  variantCode?: string;
};

export type AdjustmentHistory = {
  id: string;
  createdAt: string;
  variantCode: string;
  beforeStock: number;
  afterStock: number;
  delta: number;
  reason: string;
};

export type ProductionPlanHistory = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  variantCode?: string;
  plannedQuantity: number;
  dueDate: string;
  note?: string;
};

export type InventoryVariant = {
  code: string;
  currentStock: number;
  unit: string;
};

export type InventoryItem = {
  code: string;
  variants?: InventoryVariant[];
  currentStock: number;
  safetyStock: number;
  unit: string;
  inboundHistory: InboundHistory[];
  outboundHistory: OutboundHistory[];
  adjustmentHistory: AdjustmentHistory[];
  productionPlanHistory: ProductionPlanHistory[];
};

export type InventoryProduct = {
  name: string;
  imageSrc: string;
  items: InventoryItem[];
};

export type UhpInventoryState = UhpInventorySlices<InventoryProduct>;

export type CombinedHistoryRow = {
  kind: 'inbound' | 'outbound' | 'adjustment' | 'production';
  id: string;
  createdAt: string;
  quantity: number;
  variantCode?: string;
  dueDate?: string;
  raw: InboundHistory | OutboundHistory | AdjustmentHistory | ProductionPlanHistory;
};
