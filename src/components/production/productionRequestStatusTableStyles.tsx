import React from 'react';

export const listOutlineEdgeClass = 'border-slate-400';
export const listTableCellBase = `border ${listOutlineEdgeClass} align-top`;
export const listRegistrationThClass = `${listTableCellBase} bg-slate-100 px-2 py-1.5 text-xs font-semibold text-gray-700`;
export const listRegistrationTdClass = `${listTableCellBase} bg-white px-2 py-1.5 text-sm text-gray-900`;
export const listPlanTdClass = listRegistrationTdClass;
export const listCompletionTdClass = `${listRegistrationTdClass} whitespace-nowrap text-xs sm:text-sm tabular-nums min-w-[6.75rem]`;
export const listCompletionThClass = `${listRegistrationThClass} whitespace-nowrap text-[11px] sm:text-xs`;
export const listProductionIssueTdClass = listRegistrationTdClass;

export const LIST_SUMMARY_COLUMN_COUNT = 11;

/** 열 너비 합 100% — 우측 빈 틈 방지 */
export const LIST_SUMMARY_COLGROUP = (
  <colgroup>
    <col style={{ width: '3.5%' }} />
    <col style={{ width: '7%' }} />
    <col style={{ width: '10%' }} />
    <col style={{ width: '13%' }} />
    <col style={{ width: '7%' }} />
    <col style={{ width: '8%' }} />
    <col style={{ width: '7%' }} />
    <col style={{ width: '11%' }} />
    <col style={{ width: '6%' }} />
    <col style={{ width: '7%' }} />
    <col style={{ width: '11.5%' }} />
  </colgroup>
);

export const listSummaryThClass =
  'border border-slate-400 bg-blue-100 px-2 py-2 text-xs font-semibold text-blue-950 whitespace-nowrap text-center';
export const listSummaryTdClass =
  'border border-slate-400 px-2 py-2 text-sm text-gray-900 align-middle text-center';

export const listSummaryActionsThClass = `${listSummaryThClass} px-1.5`;
export const listSummaryActionsTdClass = `${listSummaryTdClass} px-1.5 whitespace-nowrap`;

/** 상세 블록: 등록 행(도면 포함) 기준 10열 */
export const LIST_DETAIL_INNER_COLUMN_COUNT = 10;

export const LIST_DETAIL_INNER_COLGROUP = (
  <colgroup>
    <col style={{ width: '9%' }} />
    <col style={{ width: '8%' }} />
    <col style={{ width: '8%' }} />
    <col style={{ width: '7%' }} />
    <col style={{ width: '10%' }} />
    <col style={{ width: '8%' }} />
    <col style={{ width: '9%' }} />
    <col style={{ width: '9%' }} />
    <col style={{ width: '11%' }} />
    <col style={{ width: '7%' }} />
  </colgroup>
);
