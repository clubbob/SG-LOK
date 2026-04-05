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

export type UhpInventorySlices<T> = {
  products: T[];
  tubeButtWeldProducts: T[];
  metalFaceSealProducts: T[];
};

/** 기존 Firestore 필드 3종에 대응 */
export type UhpLegacySliceKey = 'products' | 'tubeButtWeldProducts' | 'metalFaceSealProducts';

export type UhpTabSlice =
  | { kind: 'legacy'; key: UhpLegacySliceKey }
  | { kind: 'custom'; customId: string };

export type UhpCategoryTabDef = {
  id: string;
  label: string;
  slice: UhpTabSlice;
};

export type UhpInventoryState = UhpInventorySlices<InventoryProduct> & {
  categoryTabs: UhpCategoryTabDef[];
  customCategoryProducts: Record<string, InventoryProduct[]>;
};

export type CombinedHistoryRow = {
  kind: 'inbound' | 'outbound' | 'adjustment' | 'production';
  id: string;
  createdAt: string;
  quantity: number;
  variantCode?: string;
  dueDate?: string;
  raw: InboundHistory | OutboundHistory | AdjustmentHistory | ProductionPlanHistory;
};
