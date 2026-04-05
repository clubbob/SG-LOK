import type { InventoryItem, InventoryProduct, UhpInventoryState } from './types';
import { getTabSliceProducts } from './uhpInventoryHelpers';

export type SearchFilteredProduct = InventoryProduct & {
  filteredItems: InventoryItem[];
  isProductNameMatched: boolean;
};

/**
 * @param mode strict — 품목·코드가 하나도 안 맞으면 제외(사용자 재고현황).
 *        admin — 제품명만 맞아도 노출(품목 없음 카드 등, 관리자 재고현황).
 */
export function filterProductsBySearchQuery(
  products: InventoryProduct[],
  normalizedQuery: string,
  mode: 'strict' | 'admin'
): SearchFilteredProduct[] {
  const q = normalizedQuery;
  const mapped = products.map((product) => {
    const isProductNameMatched = q === '' || product.name.toLowerCase().includes(q);
    const nameMatches = product.name.toLowerCase().includes(q);
    const filteredItems =
      q === '' || nameMatches
        ? product.items
        : product.items.filter(
            (item) =>
              item.code.toLowerCase().includes(q) ||
              item.variants?.some((v) => v.code.toLowerCase().includes(q))
          );
    return { ...product, filteredItems, isProductNameMatched };
  });
  if (mode === 'strict') {
    return mapped.filter((p) => p.filteredItems.length > 0);
  }
  return mapped.filter(
    (product) => product.filteredItems.length > 0 || q === '' || product.isProductNameMatched
  );
}

/**
 * 검색 결과가 있는 카테고리 중에서 탭 id를 고릅니다.
 */
export function pickCategoryIdForSearch(
  state: UhpInventoryState,
  normalizedQuery: string,
  mode: 'strict' | 'admin'
): string | null {
  const q = normalizedQuery.trim().toLowerCase();
  if (!q) return null;

  type Scored = { tabId: string; score: number; codeRows: number; order: number };
  const scored: Scored[] = [];

  state.categoryTabs.forEach((tab, order) => {
    const slice = getTabSliceProducts(state, tab);
    const filtered = filterProductsBySearchQuery(slice, q, mode);
    if (filtered.length === 0) return;

    let score = 0;
    let codeRows = 0;
    for (const p of filtered) {
      let productBest = 0;
      for (const item of p.filteredItems) {
        if (item.code.toLowerCase().includes(q)) {
          productBest = Math.max(productBest, 100);
          codeRows += 1;
        } else if (item.variants?.some((v) => v.code.toLowerCase().includes(q))) {
          productBest = Math.max(productBest, 50);
          codeRows += 1;
        }
      }
      if (productBest === 0 && p.name.toLowerCase().includes(q)) {
        productBest = 1;
      }
      score += productBest;
    }
    scored.push({ tabId: tab.id, score, codeRows, order });
  });

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score || b.codeRows - a.codeRows || a.order - b.order);
  return scored[0]!.tabId;
}
