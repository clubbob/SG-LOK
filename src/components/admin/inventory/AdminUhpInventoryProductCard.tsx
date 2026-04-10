'use client';

import { InventoryItemDndGrid } from '@/components/admin/inventory/InventoryItemDndGrid';
import type { InventoryItem, ProductionPlanHistory } from '@/lib/inventory/types';
import type { ReactNode } from 'react';

export type AdminUhpProductListRow = {
  name: string;
  imageSrc: string;
  items: InventoryItem[];
  filteredItems: InventoryItem[];
  isProductNameMatched: boolean;
  listKey: string;
  categoryLabel?: string;
};

type VariantPlanInfo = {
  totalPlanned: number;
  nearestDueDate: string | undefined;
};

type Props = {
  product: AdminUhpProductListRow;
  dragHandle: ReactNode | null;
  brokenImageKeys: Set<string>;
  setBrokenImageKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  getCurrentStock: (item: InventoryItem) => number;
  getVariantProductionPlanInfo: (item: InventoryItem, variantCode: string) => VariantPlanInfo | null;
  openAddStructureItem: (productName: string) => void;
  handleRenameProductLine: (productName: string) => void;
  handleDeleteProductLine: (productName: string) => void;
  handleRenameItem: (productName: string, itemCode: string) => void;
  handleDeleteItem: (productName: string, itemCode: string) => void;
  handleRenameVariant: (productName: string, itemCode: string, variantCode: string) => void;
  handleDeleteVariant: (productName: string, itemCode: string, variantCode: string) => void;
  handleAddVariant: (productName: string, itemCode: string) => void;
  openInboundCreateModal: (productName: string, itemCode: string) => void;
  openOutboundCreateModal: (productName: string, itemCode: string) => void;
  openProductionPlanCreateModal: (productName: string, itemCode: string) => void;
  openAdjustmentModal: (productName: string, itemCode: string) => void;
  openHistoryModal: (productName: string, itemCode: string) => void;
  openHistoryViewModal: (productName: string, itemCode: string) => void;
  openProductionPlanEditModal: (
    productName: string,
    itemCode: string,
    history: ProductionPlanHistory
  ) => void;
  /** 검색·재고/생산 필터 없을 때만 true — 품목 순서 드래그 저장 */
  itemReorderEnabled?: boolean;
  onItemReorder?: (productName: string, oldIndex: number, newIndex: number) => void;
};

export type AdminUhpProductCardHandlers = Omit<Props, 'product' | 'dragHandle'>;

export function AdminUhpInventoryProductCard({
  product,
  dragHandle,
  brokenImageKeys,
  setBrokenImageKeys,
  getCurrentStock,
  getVariantProductionPlanInfo,
  openAddStructureItem,
  handleRenameProductLine,
  handleDeleteProductLine,
  handleRenameItem,
  handleDeleteItem,
  handleRenameVariant,
  handleDeleteVariant,
  handleAddVariant,
  openInboundCreateModal,
  openOutboundCreateModal,
  openProductionPlanCreateModal,
  openAdjustmentModal,
  openHistoryModal,
  openHistoryViewModal,
  openProductionPlanEditModal,
  itemReorderEnabled = false,
  onItemReorder,
}: Props) {
  const sortableItemIds =
    itemReorderEnabled && onItemReorder
      ? product.items.map((item) => `${product.listKey}::item::${item.code}`)
      : [];

  const renderItemBlock = (item: InventoryItem, dragHandle: ReactNode | null) => (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
      <div className="flex items-start gap-2">
        {dragHandle}
        <div
          className="min-w-0 flex-1"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const currentStock = getCurrentStock(item);
            return (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-800">{item.code}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-2.5 py-1 text-sm font-bold shadow-sm ${
                        currentStock > 0
                          ? 'border-2 border-emerald-600 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300'
                          : 'border border-blue-300 bg-blue-100 text-blue-900'
                      }`}
                    >
                      총 현재고 {currentStock} {item.unit}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRenameItem(product.name, item.code)}
                      className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                    >
                      품목 수정
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(product.name, item.code)}
                      className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      품목 삭제
                    </button>
                  </div>
                </div>
                {item.variants && item.variants.length > 0 && (
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {item.variants.map((variant) =>
                      (() => {
                        const variantPlanInfo = getVariantProductionPlanInfo(item, variant.code);
                        const variantExpectedStock =
                          variant.currentStock + (variantPlanInfo?.totalPlanned ?? 0);
                        return (
                          <div
                            key={variant.code}
                            className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px]"
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-slate-800">
                                {variant.code}
                              </span>
                              <div className="flex items-center gap-1">
                              <span
                                className={`rounded-md px-2 py-0.5 text-xs font-bold shadow-sm ${
                                  variant.currentStock > 0
                                    ? 'border-2 border-emerald-600 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300'
                                    : 'border border-blue-300 bg-blue-100 text-blue-900'
                                }`}
                              >
                                  {variant.currentStock} {variant.unit}
                                </span>
                                <button
                                  type="button"
                                  title="서브 품목 수정"
                                  onClick={() =>
                                    handleRenameVariant(product.name, item.code, variant.code)
                                  }
                                  className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                >
                                  수정
                                </button>
                                <button
                                  type="button"
                                  title="서브 품목 삭제"
                                  onClick={() =>
                                    handleDeleteVariant(product.name, item.code, variant.code)
                                  }
                                  className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                                >
                                  삭제
                                </button>
                              </div>
                            </div>
                            {variantPlanInfo && (
                              <div className="mt-2.5 flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-gray-600">
                                  {variantPlanInfo.nearestDueDate ?? '-'}
                                </span>
                                <div className="flex shrink-0 items-center gap-1">
                                  <span className="rounded-md border-2 border-purple-600 bg-purple-100 px-2.5 py-0.5 text-xs font-bold text-purple-900 ring-1 ring-purple-300 shadow-sm">
                                    예상 {variantExpectedStock} {variant.unit}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleAddVariant(product.name, item.code)}
                    className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    + 서브 품목 추가
                  </button>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => openInboundCreateModal(product.name, item.code)}
                      className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                    >
                      입고
                    </button>
                    <button
                      type="button"
                      onClick={() => openOutboundCreateModal(product.name, item.code)}
                      className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      출고
                    </button>
                    <button
                      type="button"
                      onClick={() => openProductionPlanCreateModal(product.name, item.code)}
                      className="rounded border border-purple-200 bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100"
                    >
                      생산계획
                    </button>
                    <button
                      type="button"
                      onClick={() => openAdjustmentModal(product.name, item.code)}
                      className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    >
                      재고조정
                    </button>
                    <button
                      type="button"
                      onClick={() => openHistoryModal(product.name, item.code)}
                      className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      이력수정
                    </button>
                    <button
                      type="button"
                      onClick={() => openHistoryViewModal(product.name, item.code)}
                      className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
                    >
                      전체이력
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {dragHandle}
          <h3 className="text-lg font-semibold text-gray-900">
            {product.name}
            {product.categoryLabel != null && (
              <span className="ml-2 align-middle text-sm font-normal text-blue-700">
                ({product.categoryLabel})
              </span>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleRenameProductLine(product.name)}
            className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
          >
            제품 수정
          </button>
          <button
            type="button"
            onClick={() => handleDeleteProductLine(product.name)}
            className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            제품 삭제
          </button>
        </div>
      </div>
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
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => openAddStructureItem(product.name)}
              className="inline-flex shrink-0 items-center justify-center rounded-md border border-dashed border-blue-300 bg-blue-50/80 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
            >
              + 품목 추가
            </button>
          </div>
          {product.filteredItems.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-6 text-center text-sm text-gray-500">
              등록된 품목이 없습니다. 「품목 추가」로 품목 코드를 등록하면 SL-BA 등 6종 세부코드가 자동
              생성됩니다.
            </p>
          ) : itemReorderEnabled && onItemReorder && product.items.length > 0 ? (
            <InventoryItemDndGrid
              items={product.items}
              sortableIds={sortableItemIds}
              onReorder={(oldIndex, newIndex) => onItemReorder(product.name, oldIndex, newIndex)}
              renderItem={(item, handle) => renderItemBlock(item, handle)}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {product.filteredItems.map((item) => (
                <div key={item.code}>{renderItemBlock(item, null)}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
