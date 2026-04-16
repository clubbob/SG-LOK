"use client";

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
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
  findProductInUhpSlices,
  findTabById,
  getTabSliceProducts,
} from '@/lib/inventory/uhpInventoryHelpers';
import { buildCombinedHistoryRows, combinedHistoryRowMemo } from '@/lib/inventory/historyRows';
import type {
  InventoryItem as HistoryInventoryItem,
  InventoryProduct as CatalogInventoryProduct,
  UhpInventoryState,
} from '@/lib/inventory/types';
import { doc, onSnapshot } from 'firebase/firestore';

type InventoryVariant = {
  code: string;
  hasQuoteRequest?: boolean;
  currentStock: number;
  unit: string;
};

type InventoryItem = {
  code: string;
  variants?: InventoryVariant[];
  currentStock: number;
  safetyStock: number;
  unit: string;
  inboundHistory?: {
    id: string;
    quantity: number;
    createdAt: string;
    variantCode?: string;
  }[];
  outboundHistory?: {
    id: string;
    quantity: number;
    createdAt: string;
    variantCode?: string;
  }[];
  adjustmentHistory?: {
    id: string;
    createdAt: string;
    variantCode: string;
    beforeStock: number;
    afterStock: number;
    delta: number;
    reason: string;
  }[];
  productionPlanHistory?: {
    id: string;
    createdAt: string;
    updatedAt?: string;
    variantCode?: string;
    plannedQuantity: number;
    dueDate: string;
    note?: string;
  }[];
};

type InventoryProduct = {
  name: string;
  imageSrc: string;
  items: InventoryItem[];
};

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
const HISTORY_PAGE_SIZE = 20;

type HistoryViewModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  page: number;
};

function InventoryStatusPageContent() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
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
  const [historyViewModal, setHistoryViewModal] = useState<HistoryViewModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    page: 1,
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

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

  const getVisibleVariants = (item: InventoryItem): InventoryVariant[] => item.variants ?? [];

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

  const openHistoryViewModal = (productName: string, itemCode: string) => {
    setHistoryViewModal({
      isOpen: true,
      productName,
      itemCode,
      page: 1,
    });
  };

  const closeHistoryViewModal = () => {
    setHistoryViewModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      page: 1,
    });
  };

  const historyViewTargetItem = findProductInUhpSlices(uhpInventory, historyViewModal.productName)?.items.find(
    (item) => item.code === historyViewModal.itemCode
  ) as InventoryItem | undefined;
  const toHistoryViewItem = (item: InventoryItem | undefined): HistoryInventoryItem | undefined => {
    if (!item) return undefined;
    return {
      ...item,
      inboundHistory: item.inboundHistory ?? [],
      outboundHistory: item.outboundHistory ?? [],
      adjustmentHistory: item.adjustmentHistory ?? [],
      productionPlanHistory: item.productionPlanHistory ?? [],
    };
  };
  const combinedHistoryViewRows = buildCombinedHistoryRows(toHistoryViewItem(historyViewTargetItem));
  const historyViewTotalPages = Math.max(
    1,
    Math.ceil(combinedHistoryViewRows.length / HISTORY_PAGE_SIZE)
  );
  const historyViewCurrentPage = Math.min(historyViewModal.page, historyViewTotalPages);
  const pagedHistoryViewRows = combinedHistoryViewRows.slice(
    (historyViewCurrentPage - 1) * HISTORY_PAGE_SIZE,
    historyViewCurrentPage * HISTORY_PAGE_SIZE
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="w-full max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="mb-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">UHP 재고현황</h1>
                <p className="text-gray-600 mt-2">현재 UHP 재고 현황을 검색하는 페이지입니다.</p>
              </div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                새로고침
              </button>
            </div>
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
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                      <div className="h-[150px] w-full overflow-hidden rounded-md border border-gray-200 bg-white">
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
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => openHistoryViewModal(product.name, item.code)}
                                  className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 shadow-sm hover:bg-indigo-100"
                                >
                                  전체이력
                                </button>
                              </div>
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
                                        <div className="flex items-center justify-between gap-1.5">
                                          <span
                                            className={`rounded px-1.5 py-0.5 text-xs font-semibold tracking-wide ${
                                              variant.hasQuoteRequest
                                                ? 'border-2 border-rose-500 bg-rose-100 text-rose-900 ring-1 ring-rose-300 shadow-sm'
                                                : 'border border-slate-300 bg-slate-50 text-slate-800'
                                            }`}
                                          >
                                            {variant.code}
                                          </span>
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
                                          <div className="mt-2.5 flex flex-nowrap items-center justify-between gap-1">
                                            <span className="min-w-0 whitespace-nowrap text-[11px] font-medium tracking-tight text-gray-600">
                                              완료예정 {variantPlanInfo.nearestDueDate ?? '-'}
                                            </span>
                                            <div className="flex shrink-0 items-center gap-1">
                                              <span className="whitespace-nowrap rounded-md border-2 border-purple-600 bg-purple-100 px-2 py-0.5 text-[11px] font-bold text-purple-900 ring-1 ring-purple-300 shadow-sm">
                                                예상재고 {variantExpectedStock} {variant.unit}
                                              </span>
                                            </div>
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

        {historyViewModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
            <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
              <div className="shrink-0 border-b border-gray-200 px-5 py-4">
                <h3 className="text-lg font-semibold text-gray-900">전체이력</h3>
                <p className="mt-1 text-sm text-gray-600">
                  {historyViewModal.productName} / {historyViewModal.itemCode}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  입고·출고·재고조정·생산계획을 시간순으로 조회합니다. (조회 전용) 한 페이지에 최대{' '}
                  {HISTORY_PAGE_SIZE}건이며, 하단에서 페이지를 넘겨 전체를 볼 수 있습니다.
                </p>
              </div>
              <div className="min-h-0 flex-1 px-5 py-4">
                {pagedHistoryViewRows.length === 0 ? (
                  <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                    등록된 이력이 없습니다.
                  </p>
                ) : (
                  <div className="max-h-[min(50vh,26rem)] overflow-auto rounded-md border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="sticky top-0 z-[1] bg-gray-50 text-gray-700 shadow-[0_1px_0_0_rgb(229_231_235)]">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">일시</th>
                          <th className="px-3 py-2 text-left font-semibold">구분</th>
                          <th className="px-3 py-2 text-left font-semibold">세부코드</th>
                          <th className="px-3 py-2 text-left font-semibold">생산완료일</th>
                          <th className="px-3 py-2 text-right font-semibold">수량</th>
                          <th className="px-3 py-2 text-left font-semibold min-w-[140px]">비고</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {pagedHistoryViewRows.map((row) => (
                          <tr key={`view-${row.kind}-${row.id}`}>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                              {new Date(row.createdAt).toLocaleString('ko-KR')}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                                  row.kind === 'inbound'
                                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                                    : row.kind === 'outbound'
                                      ? 'border-red-200 bg-red-50 text-red-700'
                                      : row.kind === 'adjustment'
                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                        : 'border-purple-200 bg-purple-50 text-purple-700'
                                }`}
                              >
                                {row.kind === 'inbound'
                                  ? '입고'
                                  : row.kind === 'outbound'
                                    ? '출고'
                                    : row.kind === 'adjustment'
                                      ? '조정'
                                      : '생산계획'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-700">{row.variantCode || '-'}</td>
                            <td className="px-3 py-2 text-gray-700">
                              {row.kind === 'production' ? row.dueDate : '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-gray-800 whitespace-nowrap">
                              {row.kind === 'adjustment' && row.quantity > 0
                                ? `+${row.quantity}`
                                : row.quantity}
                            </td>
                            <td className="px-3 py-2 text-gray-600 text-xs max-w-xs break-words">
                              {combinedHistoryRowMemo(row)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-4">
                <div className="text-sm text-gray-600">
                  총 {combinedHistoryViewRows.length}건 / {historyViewCurrentPage} / {historyViewTotalPages} 페이지
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setHistoryViewModal((prev) => ({
                        ...prev,
                        page: Math.max(1, prev.page - 1),
                      }))
                    }
                    disabled={historyViewCurrentPage <= 1}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    이전
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setHistoryViewModal((prev) => ({
                        ...prev,
                        page: Math.min(historyViewTotalPages, prev.page + 1),
                      }))
                    }
                    disabled={historyViewCurrentPage >= historyViewTotalPages}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    다음
                  </button>
                  <button
                    type="button"
                    onClick={closeHistoryViewModal}
                    className="ml-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
