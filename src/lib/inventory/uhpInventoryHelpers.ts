import type {
  InventoryProduct,
  UhpCategoryTabDef,
  UhpInventorySlices,
  UhpInventoryState,
  UhpLegacySliceKey,
} from './types';

/** @deprecated 탭은 `state.categoryTabs` 기준으로 사용하세요. */
export type UhpCategoryId = 'microWeld' | 'tubeButtWeld' | 'metalFaceSeal';

export const DEFAULT_UHP_CATEGORY_TABS: UhpCategoryTabDef[] = [
  { id: 'microWeld', label: 'Micro Weld Fittings', slice: { kind: 'legacy', key: 'products' } },
  {
    id: 'tubeButtWeld',
    label: 'Tube Butt Weld Fittings',
    slice: { kind: 'legacy', key: 'tubeButtWeldProducts' },
  },
  {
    id: 'metalFaceSeal',
    label: 'Metal Face Seal Fittings',
    slice: { kind: 'legacy', key: 'metalFaceSealProducts' },
  },
];

/** @deprecated UI는 `uhpInventory.categoryTabs`를 사용하세요. */
export const UHP_CATEGORY_TABS: { id: UhpCategoryId; label: string }[] = DEFAULT_UHP_CATEGORY_TABS.map(
  (t) => ({ id: t.id as UhpCategoryId, label: t.label })
);

export const UHP_STATE_KEYS: Record<
  UhpCategoryId,
  'products' | 'tubeButtWeldProducts' | 'metalFaceSealProducts'
> = {
  microWeld: 'products',
  tubeButtWeld: 'tubeButtWeldProducts',
  metalFaceSeal: 'metalFaceSealProducts',
};

export type UhpCategoryTabFirestoreRow = {
  id: string;
  label: string;
  legacyKey?: UhpLegacySliceKey;
  customId?: string;
};

function tabRowToDef(row: UhpCategoryTabFirestoreRow): UhpCategoryTabDef | null {
  const id = row.id?.trim();
  const label = row.label?.trim();
  if (!id || !label) return null;
  if (
    row.legacyKey === 'products' ||
    row.legacyKey === 'tubeButtWeldProducts' ||
    row.legacyKey === 'metalFaceSealProducts'
  ) {
    return { id, label: row.label, slice: { kind: 'legacy', key: row.legacyKey } };
  }
  const customId = row.customId?.trim();
  if (customId) {
    return { id, label: row.label, slice: { kind: 'custom', customId } };
  }
  return null;
}

export function tabDefToFirestoreRow(tab: UhpCategoryTabDef): UhpCategoryTabFirestoreRow {
  if (tab.slice.kind === 'legacy') {
    return { id: tab.id, label: tab.label, legacyKey: tab.slice.key };
  }
  return { id: tab.id, label: tab.label, customId: tab.slice.customId };
}

export function normalizeUhpCategoryTabs(raw: unknown): UhpCategoryTabDef[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_UHP_CATEGORY_TABS.map((t) => JSON.parse(JSON.stringify(t)) as UhpCategoryTabDef);
  }
  const parsed: UhpCategoryTabDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const def = tabRowToDef({
      id: typeof r.id === 'string' ? r.id : '',
      label: typeof r.label === 'string' ? r.label : '',
      legacyKey:
        r.legacyKey === 'products' ||
        r.legacyKey === 'tubeButtWeldProducts' ||
        r.legacyKey === 'metalFaceSealProducts'
          ? r.legacyKey
          : undefined,
      customId: typeof r.customId === 'string' ? r.customId : undefined,
    });
    if (def) parsed.push(def);
  }
  const legacySeen = new Set<UhpLegacySliceKey>();
  const deduped: UhpCategoryTabDef[] = [];
  for (const t of parsed) {
    if (t.slice.kind === 'legacy') {
      if (legacySeen.has(t.slice.key)) continue;
      legacySeen.add(t.slice.key);
    }
    deduped.push(t);
  }
  const required: UhpLegacySliceKey[] = ['products', 'tubeButtWeldProducts', 'metalFaceSealProducts'];
  for (const key of required) {
    if (!deduped.some((t) => t.slice.kind === 'legacy' && t.slice.key === key)) {
      const d = DEFAULT_UHP_CATEGORY_TABS.find((t) => t.slice.kind === 'legacy' && t.slice.key === key);
      if (d) deduped.push(JSON.parse(JSON.stringify(d)) as UhpCategoryTabDef);
    }
  }
  return deduped.length > 0
    ? deduped
    : DEFAULT_UHP_CATEGORY_TABS.map((t) => JSON.parse(JSON.stringify(t)) as UhpCategoryTabDef);
}

export function normalizeCustomCategoryProducts(raw: unknown): Record<string, InventoryProduct[]> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, InventoryProduct[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key || !Array.isArray(v)) continue;
    out[key] = v as InventoryProduct[];
  }
  return out;
}

export function attachTabsToUhpState(
  slices: UhpInventorySlices<InventoryProduct>,
  data: { uhpCategoryTabs?: unknown; customCategoryProducts?: unknown } | undefined
): UhpInventoryState {
  return {
    ...slices,
    categoryTabs: normalizeUhpCategoryTabs(data?.uhpCategoryTabs),
    customCategoryProducts: normalizeCustomCategoryProducts(data?.customCategoryProducts),
  };
}

export function getTabSliceProducts(state: UhpInventoryState, tab: UhpCategoryTabDef): InventoryProduct[] {
  if (tab.slice.kind === 'legacy') {
    return state[tab.slice.key];
  }
  return state.customCategoryProducts[tab.slice.customId] ?? [];
}

export function setTabSliceProducts(
  state: UhpInventoryState,
  tab: UhpCategoryTabDef,
  products: InventoryProduct[]
): UhpInventoryState {
  if (tab.slice.kind === 'legacy') {
    return { ...state, [tab.slice.key]: products };
  }
  return {
    ...state,
    customCategoryProducts: {
      ...state.customCategoryProducts,
      [tab.slice.customId]: products,
    },
  };
}

export function findTabById(state: UhpInventoryState, tabId: string): UhpCategoryTabDef | null {
  return state.categoryTabs.find((t) => t.id === tabId) ?? null;
}

export function findUhpTabDefByProductName(
  state: UhpInventoryState,
  productName: string
): UhpCategoryTabDef | null {
  for (const tab of state.categoryTabs) {
    if (getTabSliceProducts(state, tab).some((p) => p.name === productName)) {
      return tab;
    }
  }
  return null;
}

export function allUhpProductLines(state: UhpInventoryState): InventoryProduct[] {
  const parts: InventoryProduct[][] = [
    state.products,
    state.tubeButtWeldProducts,
    state.metalFaceSealProducts,
    ...Object.values(state.customCategoryProducts),
  ];
  return parts.flat();
}

/** @deprecated findUhpTabDefByProductName 사용 */
export function findUhpCategoryByProductName(
  state: UhpInventoryState,
  productName: string
): UhpCategoryId | null {
  const tab = findUhpTabDefByProductName(state, productName);
  if (!tab) return null;
  if (tab.id === 'microWeld' || tab.id === 'tubeButtWeld' || tab.id === 'metalFaceSeal') {
    return tab.id;
  }
  return null;
}

export function findProductInUhpSlices(
  state: UhpInventoryState,
  productName: string
): InventoryProduct | undefined {
  for (const key of ['products', 'tubeButtWeldProducts', 'metalFaceSealProducts'] as const) {
    const found = state[key].find((p) => p.name === productName);
    if (found) return found;
  }
  for (const lines of Object.values(state.customCategoryProducts)) {
    const found = lines.find((p) => p.name === productName);
    if (found) return found;
  }
  return undefined;
}

export function newCustomCategoryId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function isCustomTab(tab: UhpCategoryTabDef): boolean {
  return tab.slice.kind === 'custom';
}
