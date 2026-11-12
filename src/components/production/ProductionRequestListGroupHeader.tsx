'use client';

import React from 'react';
import {
  getProductionRequestLineProductGroup,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';
import {
  getProductionListRowGroupLabel,
  type ProductionRequestListViewTab,
} from '@/lib/production/productionRequestListView';
import { getProductionProductGroupCardTheme } from '@/lib/production/productionProductGroupTheme';

export function ProductionRequestListGroupHeader({
  listRow,
  tab,
  count,
  isFirstOnPage = false,
}: {
  listRow: ProductionRequestListRow;
  tab: ProductionRequestListViewTab;
  count: number;
  isFirstOnPage?: boolean;
}) {
  const rawProductGroup = listRow.request.products?.[listRow.productIndex]?.productGroup;
  const displayLabel = getProductionRequestLineProductGroup(listRow);
  const theme = getProductionProductGroupCardTheme(rawProductGroup, displayLabel);

  const title =
    tab === 'by_product_group'
      ? getProductionListRowGroupLabel(listRow, tab)
      : listRow.machineNo?.trim()
        ? `기계명 ${listRow.machineNo.trim()}`
        : '기계 미배정';

  const headerSurfaceClass =
    tab === 'by_product_group' ? theme.headerRowClass : 'bg-slate-50';

  return (
    <div
      className={`mb-2 flex items-center justify-between gap-3 rounded-lg border border-slate-300 px-3 py-2 shadow-sm ${headerSurfaceClass} ${isFirstOnPage ? 'mt-0' : 'mt-4'}`}
    >
      <h2 className="text-sm font-bold tracking-wide text-gray-900 uppercase">{title}</h2>
      <span className="shrink-0 text-xs font-medium text-gray-500 tabular-nums">{count}건</span>
    </div>
  );
}
