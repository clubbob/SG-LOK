export type UhpCategoryId = 'microWeld' | 'tubeButtWeld' | 'metalFaceSeal';

export const UHP_CATEGORY_TABS: { id: UhpCategoryId; label: string }[] = [
  { id: 'microWeld', label: 'Micro Weld Fittings' },
  { id: 'tubeButtWeld', label: 'Tube Butt Weld Fittings' },
  { id: 'metalFaceSeal', label: 'Metal Face Seal Fittings' },
];

export const UHP_STATE_KEYS: Record<
  UhpCategoryId,
  'products' | 'tubeButtWeldProducts' | 'metalFaceSealProducts'
> = {
  microWeld: 'products',
  tubeButtWeld: 'tubeButtWeldProducts',
  metalFaceSeal: 'metalFaceSealProducts',
};

export type UhpInventorySlices<T> = {
  products: T[];
  tubeButtWeldProducts: T[];
  metalFaceSealProducts: T[];
};

export function findUhpCategoryByProductName<T extends { name: string }>(
  state: UhpInventorySlices<T>,
  productName: string
): UhpCategoryId | null {
  if (state.products.some((p) => p.name === productName)) return 'microWeld';
  if (state.tubeButtWeldProducts.some((p) => p.name === productName)) return 'tubeButtWeld';
  if (state.metalFaceSealProducts.some((p) => p.name === productName)) return 'metalFaceSeal';
  return null;
}

export function findProductInUhpSlices<T extends { name: string }>(
  state: UhpInventorySlices<T>,
  productName: string
): T | undefined {
  for (const key of ['products', 'tubeButtWeldProducts', 'metalFaceSealProducts'] as const) {
    const found = state[key].find((p) => p.name === productName);
    if (found) return found;
  }
  return undefined;
}
