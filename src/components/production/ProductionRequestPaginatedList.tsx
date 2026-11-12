'use client';

import React from 'react';
import type { ProductionRequestListRow } from '@/lib/production/productionRequestDisplay';
import {
  countProductionListRowGroups,
  getProductionListRowGroupKey,
  getProductionListRowGroupLabel,
  listRowNumberForPageDisplay,
  type ProductionRequestListViewTab,
} from '@/lib/production/productionRequestListView';
import {
  LIST_SUMMARY_COLUMN_COUNT,
  LIST_SUMMARY_COLGROUP,
  listSummaryActionsThClass,
  listSummaryThClass,
} from '@/components/production/productionRequestStatusTableStyles';

const SUMMARY_HEADERS = [
  'No',
  '요청일',
  '고객사명',
  '제품코드',
  '생산요청',
  '완료요청일',
  '생산계획',
  '최근완료 (수량)',
  '상세',
  '상태',
  '작업',
] as const;

export function ProductionRequestPaginatedList({
  viewTab,
  displayedListRows,
  allRowsForView,
  currentPage,
  itemsPerPage,
  renderTableRow,
}: {
  viewTab: ProductionRequestListViewTab;
  displayedListRows: ProductionRequestListRow[];
  allRowsForView: ProductionRequestListRow[];
  currentPage: number;
  itemsPerPage: number;
  renderTableRow: (listRow: ProductionRequestListRow, rowNumber: number) => React.ReactNode;
}) {
  const groupCounts = React.useMemo(
    () => countProductionListRowGroups(allRowsForView, viewTab),
    [allRowsForView, viewTab]
  );

  let groupHeaderIndex = 0;

  return (
    <div className="w-full overflow-x-auto overflow-y-visible rounded-lg border-2 border-slate-400 bg-white shadow-sm [scrollbar-gutter:stable]">
      <table className="w-full min-w-[72rem] table-fixed border-collapse border-slate-400 text-left">
        {LIST_SUMMARY_COLGROUP}
        <caption className="sr-only">생산요청 현황 목록</caption>
        <thead>
          <tr>
            {SUMMARY_HEADERS.map((label, index) => (
              <th
                key={label}
                scope="col"
                className={
                  label === '작업'
                    ? listSummaryActionsThClass
                    : `${listSummaryThClass} ${index === 0 ? 'w-12' : ''}`
                }
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayedListRows.map((listRow, idx) => {
            const rowNumber = listRowNumberForPageDisplay(
              idx,
              currentPage,
              itemsPerPage,
              displayedListRows.length,
              viewTab
            );

            const groupKey =
              viewTab !== 'by_request' ? getProductionListRowGroupKey(listRow, viewTab) : '';
            const prevKey =
              idx > 0 && viewTab !== 'by_request'
                ? getProductionListRowGroupKey(displayedListRows[idx - 1], viewTab)
                : null;
            const showGroupHeader = Boolean(groupKey && groupKey !== prevKey);
            const groupCount = groupKey ? groupCounts.get(groupKey) ?? 0 : 0;

            const groupLabel = getProductionListRowGroupLabel(listRow, viewTab);
            return (
              <React.Fragment key={`${listRow.rowKey}-${viewTab}`}>
                {showGroupHeader ? (
                  <tr
                    key={`group-${groupKey}-${groupHeaderIndex++}`}
                    className="bg-slate-50"
                  >
                    <td
                      colSpan={LIST_SUMMARY_COLUMN_COUNT}
                      className="border border-slate-400 px-3 py-2 text-sm font-bold uppercase tracking-wide text-gray-900"
                    >
                      <span>{groupLabel}</span>
                      <span className="ml-2 text-xs font-medium text-gray-500 tabular-nums">
                        {groupCount}건
                      </span>
                    </td>
                  </tr>
                ) : null}
                {renderTableRow(listRow, rowNumber)}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
