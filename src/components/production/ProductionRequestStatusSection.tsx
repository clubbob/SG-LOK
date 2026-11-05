"use client";

import React from 'react';
import {
  buildProductionRequestRegistrationFields,
  formatProductionCompletionRoundDisplay,
  getProductionRequestLineProductGroup,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';
import { getProductionProductGroupCardTheme } from '@/lib/production/productionProductGroupTheme';
import { formatDateShort } from '@/lib/utils';

function isDateAfter(a?: Date, b?: Date): boolean {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return da.getTime() > db.getTime();
}

function truncateRemarkPreview(remark?: string, maxChars = 12): string {
  const text = remark?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return '-';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

const REGISTRATION_FIELD_LABEL_NOWRAP = new Set([
  '생산목적',
  '고객사명',
  '수주수량',
  '생산요청수량',
  '완료요청일',
  '비고',
]);

const REGISTRATION_FIELDS_OMIT_IN_LIST = new Set(['제품군', '제품명', '제품코드']);

const registrationValueTruncateLabels = new Set(['고객사명', '비고']);

/** 카드 상·우·하 외곽 및 타이틀 구분선 — 좌측 accent 제외 */
const cardOutlineEdgeClass = 'border-slate-400';
const cardOutlineFrameClass = 'border-2';

const tableCellBase = `border ${cardOutlineEdgeClass} align-top`;

/** 표 바깥쪽과 래퍼 외곽선이 겹치지 않도록 */
const tablePerimeterClass =
  '[&_tr:last-child_td]:border-b-0 [&_tr:last-child_th]:border-b-0 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0';

const registrationThClass = `${tableCellBase} bg-slate-100 px-2 py-1.5 text-xs font-semibold text-gray-700`;
const registrationTdClass = `${tableCellBase} bg-white px-2 py-1.5 text-sm text-gray-900`;

const planTdClass = registrationTdClass;
const completionTdClass = registrationTdClass;
const productionIssueTdClass = registrationTdClass;

function TableHeadingCell({
  children,
  className,
  nowrap = true,
}: {
  children: React.ReactNode;
  className: string;
  nowrap?: boolean;
}) {
  const titleText = typeof children === 'string' ? children : undefined;
  return (
    <th scope="col" className={`${className} text-left font-semibold max-w-0`}>
      <span
        className={`block min-w-0 ${nowrap ? 'truncate whitespace-nowrap' : ''}`}
        title={titleText}
      >
        {children}
      </span>
    </th>
  );
}

function TableValueCell({
  children,
  className,
  valueClassName = '',
}: {
  children: React.ReactNode;
  className: string;
  valueClassName?: string;
}) {
  return (
    <td className={`${className} max-w-0`}>
      <div className={`min-w-0 leading-snug ${valueClassName}`}>{children}</div>
    </td>
  );
}

/** 등록·생산 9열 동일 너비 — 위·아래 행 세로 정렬 및 1~3차 열 균등 */
const TABLE_COLUMN_COUNT = 9;
const TABLE_COLGROUP = (
  <colgroup>
    {Array.from({ length: TABLE_COLUMN_COUNT }, (_, index) => (
      <col key={index} style={{ width: `${100 / TABLE_COLUMN_COUNT}%` }} />
    ))}
  </colgroup>
);

export function ProductionRequestStatusSection({
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
  const productionIssueText = listRow.productionIssue?.trim() ?? '';
  const productGroup = getProductionRequestLineProductGroup(listRow);
  const rawProductGroup = listRow.request.products?.[listRow.productIndex]?.productGroup;
  const groupTheme = getProductionProductGroupCardTheme(rawProductGroup, productGroup);

  const registrationFields = buildProductionRequestRegistrationFields(listRow, {
    includeRequestMeta: true,
  }).filter((field) => !REGISTRATION_FIELDS_OMIT_IN_LIST.has(field.label));

  const productionHeadings: { label: string; tdClass: string }[] = [
    { label: '생산계획수량', tdClass: planTdClass },
    { label: '완료예정일', tdClass: planTdClass },
    { label: '기계 No.', tdClass: planTdClass },
    ...listRow.completionRounds.map((_, index) => ({
      label: `${index + 1}차 완료일 (수량)`,
      tdClass: completionTdClass,
    })),
    { label: 'UHP 세정/EP (수량)', tdClass: completionTdClass },
    { label: '생산완료일 (수량)', tdClass: completionTdClass },
    { label: '생산 이슈', tdClass: productionIssueTdClass },
  ];

  return (
    <article
      className={`rounded-lg overflow-hidden bg-white ${cardOutlineFrameClass} ${cardOutlineEdgeClass} ${groupTheme.cardLeftBorderClass}`}
    >
      <table
        className={`w-full table-fixed border-collapse text-left ${tablePerimeterClass}`}
      >
        {TABLE_COLGROUP}
        <caption className="sr-only">
          생산요청 {rowNumber}번 {listRow.productName}
        </caption>
        <tbody>
          <tr className={groupTheme.headerRowClass}>
            <td
              colSpan={TABLE_COLUMN_COUNT}
              className={`px-3 py-2 border-0 border-b ${cardOutlineEdgeClass}`}
            >
              <div className="flex items-center justify-between gap-3 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex shrink-0 items-center justify-center min-w-[1.75rem] h-7 px-1.5 rounded-md bg-slate-700 text-white text-xs font-semibold tabular-nums">
                    {rowNumber}
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center max-w-[9rem] sm:max-w-[11rem] rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide truncate ${groupTheme.groupBadgeClass}`}
                    title={productGroup}
                  >
                    {productGroup}
                  </span>
                  <span className="truncate min-w-0 align-middle">
                    <span
                      className={`text-sm font-semibold leading-5 ${groupTheme.productLineTextClass}`}
                      title={listRow.productName}
                    >
                      {listRow.productName}
                      {request.itemName && listRow.productIndex === 0 ? ` (${request.itemName})` : ''}
                    </span>
                    {listRow.productCode && listRow.productCode !== '-' ? (
                      <>
                        <span
                          className={`px-2 text-sm font-normal select-none ${groupTheme.pipeClass}`}
                          aria-hidden
                        >
                          |
                        </span>
                        <span
                          className={`text-sm font-semibold leading-5 ${groupTheme.productLineTextClass}`}
                          title={listRow.productCode}
                        >
                          {listRow.productCode}
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {statusBadge}
                  {actions}
                </div>
              </div>
            </td>
          </tr>

          <tr aria-label="생산요청 등록 항목">
            {registrationFields.map((field) => (
              <TableHeadingCell
                key={`reg-h-${field.label}`}
                className={registrationThClass}
                nowrap={REGISTRATION_FIELD_LABEL_NOWRAP.has(field.label)}
              >
                {field.label}
              </TableHeadingCell>
            ))}
          </tr>
          <tr aria-label="생산요청 등록 내용">
            {registrationFields.map((field) => {
              const valueTruncate = registrationValueTruncateLabels.has(field.label)
                ? 'truncate whitespace-nowrap'
                : '';

              if (field.label === '비고') {
                return (
                  <TableValueCell key={`reg-v-${field.label}`} className={registrationTdClass}>
                    {listRow.remark?.trim() ? (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="min-w-0 truncate" title={listRow.remark.trim()}>
                          {truncateRemarkPreview(listRow.remark)}
                        </span>
                        <button
                          type="button"
                          onClick={onOpenMemo}
                          className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          보기
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </TableValueCell>
                );
              }

              const displayValue =
                field.value !== '' ? field.value : <span className="text-gray-400">-</span>;
              const textTitle =
                typeof field.value === 'string' && field.value !== '' && field.value !== '-'
                  ? field.value
                  : undefined;

              return (
                <TableValueCell
                  key={`reg-v-${field.label}`}
                  className={registrationTdClass}
                  valueClassName={valueTruncate}
                >
                  {typeof field.value === 'string' && registrationValueTruncateLabels.has(field.label) ? (
                    <span className="truncate block" title={textTitle}>
                      {displayValue}
                    </span>
                  ) : (
                    displayValue
                  )}
                </TableValueCell>
              );
            })}
          </tr>

          <tr aria-label="생산 처리 항목">
            {productionHeadings.map((col) => (
              <TableHeadingCell key={`prod-h-${col.label}`} className={registrationThClass}>
                {col.label}
              </TableHeadingCell>
            ))}
          </tr>
          <tr aria-label="생산 처리 내용">
            <TableValueCell
              className={planTdClass}
              valueClassName={
                listRow.plannedQuantity != null &&
                listRow.requestQuantity != null &&
                listRow.plannedQuantity < listRow.requestQuantity
                  ? 'text-red-500'
                  : ''
              }
            >
              {listRow.plannedQuantity != null ? (
                listRow.plannedQuantity.toLocaleString()
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </TableValueCell>
            <TableValueCell
              className={planTdClass}
              valueClassName={
                isDateAfter(listRow.plannedCompletionDate, lineRequestedDate) ? 'text-red-500' : ''
              }
            >
              {listRow.plannedCompletionDate ? (
                formatDateShort(listRow.plannedCompletionDate)
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </TableValueCell>
            <TableValueCell className={planTdClass}>
              {listRow.machineNo?.trim() ? (
                listRow.machineNo.trim()
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </TableValueCell>
            {listRow.completionRounds.map((round, index) => {
              const display = formatProductionCompletionRoundDisplay(round);
              return (
                <TableValueCell key={`prod-v-round-${index + 1}`} className={completionTdClass}>
                  {display === '-' ? <span className="text-gray-400">-</span> : display}
                </TableValueCell>
              );
            })}
            <TableValueCell className={completionTdClass}>
              {(() => {
                const display = formatProductionCompletionRoundDisplay(listRow.cleaningEpCompletion);
                return display === '-' ? <span className="text-gray-400">-</span> : display;
              })()}
            </TableValueCell>
            <TableValueCell
              className={completionTdClass}
              valueClassName={
                isDateAfter(listRow.actualCompletion.date, listRow.plannedCompletionDate)
                  ? 'text-red-500'
                  : ''
              }
            >
              {(() => {
                const display = formatProductionCompletionRoundDisplay(listRow.actualCompletion);
                return display === '-' ? <span className="text-gray-400">-</span> : display;
              })()}
            </TableValueCell>
            <TableValueCell className={productionIssueTdClass}>
              {productionIssueText ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="min-w-0 truncate" title={productionIssueText}>
                    {truncateRemarkPreview(productionIssueText)}
                  </span>
                  {onOpenProductionIssue ? (
                    <button
                      type="button"
                      onClick={onOpenProductionIssue}
                      className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      보기
                    </button>
                  ) : null}
                </div>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </TableValueCell>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
