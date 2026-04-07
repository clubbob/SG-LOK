"use client";

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { db } from '@/lib/firebase';
import {
  INITIAL_METAL_FACE_SEAL_PRODUCTS,
  INITIAL_MICRO_WELD_PRODUCTS,
  INITIAL_TUBE_BUTT_WELD_PRODUCTS,
  mergeLegacyLongElbowIntoTubeButtWeld,
  reconcileUhpInventoryWithSeedCatalog,
  stripHle02ItemFromLongElbowLine,
} from '@/lib/inventory/microWeldSeed';
import {
  filterProductsBySearchQuery,
  pickCategoryIdForSearch,
} from '@/lib/inventory/searchFilter';
import {
  attachTabsToUhpState,
  findTabById,
  getTabSliceProducts,
} from '@/lib/inventory/uhpInventoryHelpers';
import type {
  InventoryProduct as CatalogInventoryProduct,
  UhpInventoryState,
} from '@/lib/inventory/types';
import { doc, onSnapshot } from 'firebase/firestore';

type InventoryVariant = {
  code: string;
  currentStock: number;
  unit: string;
};

type InventoryItem = {
  code: string;
  variants?: InventoryVariant[];
  currentStock: number;
  safetyStock: number;
  unit: string;
  productionPlanHistory?: {
    variantCode?: string;
    plannedQuantity: number;
    dueDate: string;
  }[];
};

type InventoryProduct = {
  name: string;
  imageSrc: string;
  items: InventoryItem[];
};

const isVisibleVariantCode = (code: string): boolean => !code.toUpperCase().includes('-SL-');

const FALLBACK_UHP: UhpInventoryState = {
  products: INITIAL_MICRO_WELD_PRODUCTS as CatalogInventoryProduct[],
  tubeButtWeldProducts: INITIAL_TUBE_BUTT_WELD_PRODUCTS as CatalogInventoryProduct[],
  metalFaceSealProducts: INITIAL_METAL_FACE_SEAL_PRODUCTS as CatalogInventoryProduct[],
  categoryTabs: [
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
  ],
  customCategoryProducts: {},
};

const PRODUCT_LIST_PAGE_SIZE = 10;

function InventoryStatusPageContent() {
  const searchParams = useSearchParams();
  const stockFilterParam = searchParams.get('stock');
  const stockFilter: 'in' | 'out' | null =
    stockFilterParam === 'in' || stockFilterParam === 'out' ? stockFilterParam : null;
  const planFilterParam = searchParams.get('plan');
  const hasPlanFilter = planFilterParam === 'exists';

  const [activeTabId, setActiveTabId] = useState('microWeld');
  const [searchQuery, setSearchQuery] = useState('');
  const [tabSelectionLockedByUser, setTabSelectionLockedByUser] = useState(false);
  const [productListPage, setProductListPage] = useState(1);
  const [brokenImageKeys, setBrokenImageKeys] = useState<Set<string>>(new Set());
  const [uhpInventory, setUhpInventory] = useState<UhpInventoryState>(FALLBACK_UHP);

  useEffect(() => {
    const inventoryRef = doc(db, 'inventory', 'microWeldProducts');
    const unsubscribe = onSnapshot(
      inventoryRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setUhpInventory(FALLBACK_UHP);
          return;
        }
        const data = snapshot.data() as
          | {
              products?: InventoryProduct[];
              tubeButtWeldProducts?: InventoryProduct[];
              metalFaceSealProducts?: InventoryProduct[];
              longElbowProducts?: InventoryProduct[];
              uhpCategoryTabs?: unknown;
              customCategoryProducts?: unknown;
            }
          | undefined;
        const tubeBase = Array.isArray(data?.tubeButtWeldProducts)
          ? data!.tubeButtWeldProducts!
          : FALLBACK_UHP.tubeButtWeldProducts;
        const { next: tubeAfterLegacy } = mergeLegacyLongElbowIntoTubeButtWeld(
          tubeBase as CatalogInventoryProduct[],
          Array.isArray(data?.longElbowProducts)
            ? (data.longElbowProducts as CatalogInventoryProduct[])
            : undefined
        );
        const { next: tubeMerged } = stripHle02ItemFromLongElbowLine(tubeAfterLegacy);
        const rawSlices: UhpInventoryState = attachTabsToUhpState(
          {
            products: Array.isArray(data?.products)
              ? (data!.products! as CatalogInventoryProduct[])
              : (FALLBACK_UHP.products as CatalogInventoryProduct[]),
            tubeButtWeldProducts: tubeMerged as CatalogInventoryProduct[],
            metalFaceSealProducts: Array.isArray(data?.metalFaceSealProducts)
              ? (data!.metalFaceSealProducts! as CatalogInventoryProduct[])
              : (FALLBACK_UHP.metalFaceSealProducts as CatalogInventoryProduct[]),
          },
          data
        );
        const reconciled = reconcileUhpInventoryWithSeedCatalog(rawSlices);
        const display = reconciled.changed ? reconciled.next : rawSlices;
        setUhpInventory(display);
      },
      () => {
        setUhpInventory(FALLBACK_UHP);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setProductListPage(1);
  }, [activeTabId, searchQuery, stockFilterParam, planFilterParam]);

  useEffect(() => {
    if (!uhpInventory.categoryTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(uhpInventory.categoryTabs[0]?.id ?? 'microWeld');
    }
  }, [uhpInventory.categoryTabs, activeTabId]);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return;
    if (tabSelectionLockedByUser) return;
    const nextTab = pickCategoryIdForSearch(uhpInventory, q, 'admin');
    if (nextTab != null && nextTab !== activeTabId) {
      setActiveTabId(nextTab);
    }
  }, [searchQuery, uhpInventory, activeTabId, tabSelectionLockedByUser]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  type ProductListRow = {
    name: string;
    imageSrc: string;
    items: InventoryItem[];
    filteredItems: InventoryItem[];
    isProductNameMatched: boolean;
    listKey: string;
    categoryLabel?: string;
  };

  const getVisibleVariants = (item: InventoryItem): InventoryVariant[] =>
    (item.variants ?? []).filter((variant) => isVisibleVariantCode(variant.code));

  const getItemCurrentStock = (item: InventoryItem): number => {
    const visibleVariants = getVisibleVariants(item);
    return visibleVariants.length > 0
      ? visibleVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
      : item.currentStock;
  };

  const applyStockFilter = <T extends { filteredItems: InventoryItem[] }>(products: T[]): T[] => {
    if (!stockFilter) return products;
    const filtered = products
      .map((product) => ({
        ...product,
        filteredItems: product.filteredItems.filter((item) =>
          stockFilter === 'in' ? getItemCurrentStock(item) > 0 : getItemCurrentStock(item) <= 0
        ),
      }))
      .filter((product) => product.filteredItems.length > 0);
    return filtered as T[];
  };

  const applyPlanFilter = <T extends { filteredItems: InventoryItem[] }>(products: T[]): T[] => {
    if (!hasPlanFilter) return products;
    const filtered = products
      .map((product) => ({
        ...product,
        filteredItems: product.filteredItems.filter((item) => {
          const plans = Array.isArray(item.productionPlanHistory) ? item.productionPlanHistory : [];
          const totalPlanned = plans.reduce(
            (sum, plan) => sum + (typeof plan.plannedQuantity === 'number' ? plan.plannedQuantity : 0),
            0
          );
          return totalPlanned > 0;
        }),
      }))
      .filter((product) => product.filteredItems.length > 0);
    return filtered as T[];
  };

  const baseFilteredCategoryProducts: ProductListRow[] = isSearching
    ? uhpInventory.categoryTabs.flatMap((tab) =>
        filterProductsBySearchQuery(
          getTabSliceProducts(uhpInventory, tab) as CatalogInventoryProduct[],
          normalizedQuery,
          'admin'
        ).map((p) => ({
          ...p,
          categoryLabel: tab.label,
          listKey: `${tab.id}::${p.name}`,
        }))
      )
    : (() => {
        const tab = findTabById(uhpInventory, activeTabId);
        if (!tab) return [];
        return filterProductsBySearchQuery(
          getTabSliceProducts(uhpInventory, tab) as CatalogInventoryProduct[],
          normalizedQuery,
          'strict'
        ).map((p) => ({
          ...p,
          categoryLabel: undefined,
          listKey: `${activeTabId}::${p.name}`,
        }));
      })();

  const filteredCategoryProducts = applyPlanFilter(applyStockFilter(baseFilteredCategoryProducts));

  const productListTotalPages = Math.max(
    1,
    Math.ceil(filteredCategoryProducts.length / PRODUCT_LIST_PAGE_SIZE)
  );
  const productListEffectivePage = Math.min(productListPage, productListTotalPages);
  const pagedCategoryProducts = filteredCategoryProducts.slice(
    (productListEffectivePage - 1) * PRODUCT_LIST_PAGE_SIZE,
    productListEffectivePage * PRODUCT_LIST_PAGE_SIZE
  );
  const productListRangeStart =
    filteredCategoryProducts.length === 0
      ? 0
      : (productListEffectivePage - 1) * PRODUCT_LIST_PAGE_SIZE + 1;
  const productListRangeEnd = Math.min(
    filteredCategoryProducts.length,
    productListEffectivePage * PRODUCT_LIST_PAGE_SIZE
  );

  const getVariantProductionPlanInfo = (item: InventoryItem, variantCode: string) => {
    const plans = (item.productionPlanHistory ?? []).filter(
      (plan) => plan.variantCode === variantCode
    );
    if (plans.length === 0) return null;

    const totalPlanned = plans.reduce((sum, plan) => sum + plan.plannedQuantity, 0);
    const nearestDueDate = [...plans]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
      ?.dueDate;

    return {
      totalPlanned,
      nearestDueDate,
    };
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">UHP 재고현황</h1>
            <p className="text-gray-600 mt-2">현재 UHP 재고 현황을 검색하는 페이지입니다.</p>
          </div>

          <div className="mb-4">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
                </svg>
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setTabSelectionLockedByUser(false);
                }}
                placeholder="제품명 검색"
                className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-10 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              {searchQuery.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setTabSelectionLockedByUser(false);
                  }}
                  className="absolute inset-y-0 right-2 my-auto inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="검색어 지우기"
                  title="검색어 지우기"
                >
                  ×
                </button>
              )}
            </div>
            {isSearching && (
              <p className="mt-1.5 text-xs text-gray-500">등록된 모든 제품 카테고리에서 검색합니다.</p>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">

            <h2 className="text-lg font-semibold text-gray-900 mb-4">제품 카테고리</h2>
            <div className="flex flex-wrap gap-2">
              {uhpInventory.categoryTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTabId(tab.id);
                    if (searchQuery.trim().length > 0) {
                      setTabSelectionLockedByUser(true);
                    }
                  }}
                  className={`rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                    activeTabId === tab.id
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="mt-6 space-y-4">
              {pagedCategoryProducts.map((product) => (
                <div key={product.listKey} className="rounded-lg border border-gray-200 bg-white p-5">
                  <h3 className="mb-4 text-lg font-semibold text-gray-900">
                    {product.name}
                    {product.categoryLabel != null && (
                      <span className="ml-2 align-middle text-sm font-normal text-blue-700">
                        ({product.categoryLabel})
                      </span>
                    )}
                  </h3>
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                      <div className="h-[180px] w-full overflow-hidden rounded-md border border-gray-200 bg-white">
                        {product.imageSrc?.trim() && !brokenImageKeys.has(product.listKey) ? (
                          <img
                            src={product.imageSrc}
                            alt={product.name}
                            className="h-full w-full object-contain"
                            onError={() =>
                              setBrokenImageKeys((prev) => {
                                const next = new Set(prev);
                                next.add(product.listKey);
                                return next;
                              })
                            }
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-medium text-gray-400">
                            제품 이미지 없음
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {product.filteredItems.map((item) => (
                          <div
                            key={item.code}
                            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-gray-800">{item.code}</p>
                              <span
                                className={`rounded-md px-2.5 py-1 text-sm font-bold shadow-sm ${
                                  (item.variants && item.variants.length > 0
                                    ? item.variants.reduce((sum, variant) => sum + variant.currentStock, 0)
                                    : item.currentStock) > 0
                                    ? 'border-2 border-emerald-600 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300'
                                    : 'border border-blue-300 bg-blue-100 text-blue-900'
                                }`}
                              >
                                총 현재고{' '}
                                {item.variants && item.variants.length > 0
                                  ? item.variants.reduce(
                                      (sum, variant) => sum + variant.currentStock,
                                      0
                                    )
                                  : item.currentStock}{' '}
                                {item.unit}
                              </span>
                            </div>
                            {item.variants && getVisibleVariants(item).length > 0 && (
                              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                {getVisibleVariants(item).map((variant) => (
                                  (() => {
                                    const variantPlanInfo = getVariantProductionPlanInfo(
                                      item,
                                      variant.code
                                    );
                                    const variantExpectedStock =
                                      variant.currentStock + (variantPlanInfo?.totalPlanned ?? 0);
                                    return (
                                      <div
                                        key={variant.code}
                                        className="rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px]"
                                      >
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="font-medium text-gray-700">{variant.code}</span>
                                          <span
                                            className={`rounded-md px-2 py-0.5 text-xs font-bold shadow-sm ${
                                              variant.currentStock > 0
                                                ? 'border-2 border-emerald-600 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300'
                                                : 'border border-blue-300 bg-blue-100 text-blue-900'
                                            }`}
                                          >
                                            {variant.currentStock} {variant.unit}
                                          </span>
                                        </div>
                                        {variantPlanInfo && (
                                          <div className="mt-1 flex items-center justify-between gap-1">
                                            <span className="text-[10px] text-gray-500">
                                              {variantPlanInfo.nearestDueDate ?? '-'}
                                            </span>
                                            <span className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 font-semibold text-purple-700">
                                              예상 {variantExpectedStock} {variant.unit}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {filteredCategoryProducts.length === 0 && (
                <p className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-4 text-sm text-gray-500">
                  검색 결과가 없습니다.
                </p>
              )}
              {filteredCategoryProducts.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-600">
                    제품 라인 {productListRangeStart}–{productListRangeEnd} / 전체{' '}
                    {filteredCategoryProducts.length}건 (페이지당 {PRODUCT_LIST_PAGE_SIZE}건)
                    {productListTotalPages > 1 && (
                      <span className="text-gray-500">
                        {' '}
                        · {productListEffectivePage}/{productListTotalPages} 페이지
                      </span>
                    )}
                  </p>
                  {productListTotalPages > 1 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setProductListPage((p) => Math.max(1, p - 1))}
                        disabled={productListEffectivePage <= 1}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        이전
                      </button>

                      {(() => {
                        const total = productListTotalPages;
                        const current = productListEffectivePage;
                        const maxButtons = 10;

                        const parts: Array<number | 'ellipsis'> =
                          total <= maxButtons
                            ? Array.from({ length: total }, (_, i) => i + 1)
                            : (() => {
                                const left = Math.max(2, current - 2);
                                const right = Math.min(total - 1, current + 2);
                                const out: Array<number | 'ellipsis'> = [];
                                out.push(1);
                                if (left > 2) out.push('ellipsis');
                                for (let p = left; p <= right; p++) out.push(p);
                                if (right < total - 1) out.push('ellipsis');
                                out.push(total);
                                return out;
                              })();

                        return parts.map((part, idx) => {
                          if (part === 'ellipsis') {
                            return (
                              <span
                                key={`ellipsis-${idx}`}
                                className="select-none px-1 text-gray-400"
                              >
                                …
                              </span>
                            );
                          }

                          const pageNum = part;
                          const isActive = pageNum === current;
                          return (
                            <button
                              key={pageNum}
                              type="button"
                              onClick={() => setProductListPage(pageNum)}
                              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                                isActive
                                  ? 'border-blue-500 bg-blue-500 text-white'
                                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                              }`}
                              aria-current={isActive ? 'page' : undefined}
                            >
                              {pageNum}
                            </button>
                          );
                        });
                      })()}

                      <button
                        type="button"
                        onClick={() =>
                          setProductListPage((p) => Math.min(productListTotalPages, p + 1))
                        }
                        disabled={productListEffectivePage >= productListTotalPages}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        다음
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function InventoryStatusPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-4 text-gray-600">로딩 중...</p>
          </div>
        </div>
      }
    >
      <InventoryStatusPageContent />
    </Suspense>
  );
}
