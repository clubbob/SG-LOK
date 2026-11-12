'use client';

import React, { useState } from 'react';
import {
  formatProductionListCustomerNameDisplay,
  getProductionRequestLatestStageCompletionDisplay,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';
import { formatDateShort } from '@/lib/utils';
import { ProductionRequestStatusDetailBlock } from '@/components/production/ProductionRequestStatusDetailBlock';
import {
  LIST_SUMMARY_COLUMN_COUNT,
  listSummaryActionsTdClass,
  listSummaryTdClass,
} from '@/components/production/productionRequestStatusTableStyles';

export function ProductionRequestStatusTableRow({
  listRow,
  rowNumber,
  statusBadge,
  actions,
  onOpenMemo,
  onOpenProductionIssue,
}: {
  listRow: ProductionRequestListRow;
  rowNumber: number;
  statusBadge: React.ReactNode;
  actions?: React.ReactNode;
  onOpenMemo: () => void;
  onOpenProductionIssue?: () => void;
}) {
  const request = listRow.request;
  const lineRequestedDate = listRow.requestedCompletionDate ?? request.requestedCompletionDate;
  const productCodeDisplay =
    listRow.productCode?.trim() && listRow.productCode !== '-'
      ? listRow.productCode.trim()
      : '-';

  const [detailOpen, setDetailOpen] = useState(false);

  const cell = (value: string, extra = '') => (
    <td className={`${listSummaryTdClass} ${extra}`} title={value}>
      <span className="block truncate tabular-nums mx-auto max-w-full">{value}</span>
    </td>
  );

  return (
    <>
      <tr className="bg-white">
        <td className={`${listSummaryTdClass} w-12 text-center tabular-nums`}>
          {rowNumber}
        </td>
        {cell(request.requestDate ? formatDateShort(request.requestDate) : '-')}
        {cell(
          formatProductionListCustomerNameDisplay(listRow.productionReason, listRow.customerName),
          'max-w-[6.5rem] truncate'
        )}
        {cell(productCodeDisplay, 'max-w-[9rem] font-medium')}
        {cell(
          listRow.requestQuantity != null ? listRow.requestQuantity.toLocaleString('ko-KR') : '-'
        )}
        {cell(lineRequestedDate ? formatDateShort(lineRequestedDate) : '-')}
        {cell(
          listRow.plannedQuantity != null ? listRow.plannedQuantity.toLocaleString('ko-KR') : '-'
        )}
        {cell(getProductionRequestLatestStageCompletionDisplay(listRow), 'text-xs sm:text-sm')}
        <td className={`${listSummaryTdClass} whitespace-nowrap`}>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setDetailOpen((open) => !open)}
              aria-expanded={detailOpen}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-gray-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {detailOpen ? '접기' : '상세'}
            </button>
          </div>
        </td>
        <td className={`${listSummaryTdClass} whitespace-nowrap`}>
          <div className="flex justify-center items-center">{statusBadge}</div>
        </td>
        <td className={listSummaryActionsTdClass}>
          <div className="flex flex-nowrap items-center justify-center gap-x-1">{actions}</div>
        </td>
      </tr>
      {detailOpen ? (
        <tr className="bg-white">
          <td
            colSpan={LIST_SUMMARY_COLUMN_COUNT}
            className="border border-slate-400 p-0 align-top bg-white overflow-visible"
          >
            <div className="w-full overflow-x-auto overflow-y-visible [scrollbar-gutter:stable]">
              <div className="min-w-[64rem] p-2 box-border">
                <ProductionRequestStatusDetailBlock
                  listRow={listRow}
                  onOpenMemo={onOpenMemo}
                  onOpenProductionIssue={onOpenProductionIssue}
                />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
