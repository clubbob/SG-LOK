"use client";

import React from 'react';
import {
  buildProductionRequestRegistrationFields,
  formatProductionCompletionRoundDisplay,
  getProductionRequestLineProductGroup,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';
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

const registrationFieldCellClass =
  'rounded-md border border-slate-200 bg-slate-50/90 px-2 py-1.5 min-w-0';

/** 등록 9열 — 행 전체 너비, 비고·고객사명만 상대적으로 넓음 */
const REGISTRATION_ROW_GRID_CLASS =
  'grid w-full gap-2 sm:gap-2.5 grid-cols-[minmax(4rem,0.68fr)_minmax(4rem,0.68fr)_minmax(4.25rem,0.74fr)_minmax(3.5rem,0.58fr)_minmax(5.25rem,1.18fr)_minmax(4rem,0.68fr)_minmax(4.5rem,0.82fr)_minmax(4.25rem,0.78fr)_minmax(5rem,0.92fr)]';

const REGISTRATION_FIELD_LABEL_NOWRAP = new Set([
  '생산목적',
  '고객사명',
  '수주수량',
  '생산요청수량',
  '완료요청일',
  '비고',
]);

/** 카드 헤더에 이미 표시 — 등록 줄에서는 생략 */
const REGISTRATION_FIELDS_OMIT_IN_LIST = new Set(['제품군', '제품명', '제품코드']);

const registrationValueTruncateLabels = new Set(['고객사명', '비고']);

/** 생산 처리 한 줄 */
const planFieldCellClassRow =
  'rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5';
const completionFieldCellClassRow =
  'rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5';
const productionIssueFieldCellClassRow =
  'rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5';

function Field({
  label,
  children,
  className = '',
  valueClassName = '',
  labelClassName = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  valueClassName?: string;
  labelClassName?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div
        className={`text-xs font-semibold text-gray-700 leading-tight mb-0.5 ${labelClassName}`}
      >
        {label}
      </div>
      <div className={`text-sm text-gray-900 leading-snug break-words ${valueClassName}`}>{children}</div>
    </div>
  );
}

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

  return (
    <article className="rounded-lg border border-slate-400 bg-white overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-3 py-2 bg-gradient-to-r from-slate-50 to-gray-50 border-b border-slate-300">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 rounded-md bg-slate-700 text-white text-xs font-semibold">
            {rowNumber}
          </span>
          <span
            className="inline-flex shrink-0 items-center max-w-[9rem] sm:max-w-[11rem] rounded-md border border-slate-300 bg-slate-100/90 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-700 truncate"
            title={productGroup}
          >
            {productGroup}
          </span>
          <span className="text-sm font-semibold text-gray-900 truncate min-w-0" title={listRow.productName}>
            {listRow.productName}
            {request.itemName && listRow.productIndex === 0 ? ` (${request.itemName})` : ''}
          </span>
          {listRow.productCode && listRow.productCode !== '-' ? (
            <span
              className="inline-flex shrink-0 items-center max-w-[9rem] sm:max-w-[12rem] rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-sm font-semibold font-mono text-indigo-800 truncate"
              title={listRow.productCode}
            >
              {listRow.productCode}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {statusBadge}
          {actions}
        </div>
      </header>

      <div
        className={`${REGISTRATION_ROW_GRID_CLASS} px-3 py-2.5 bg-white border-b border-slate-300 overflow-x-auto`}
        aria-label="생산요청 등록"
      >
        {buildProductionRequestRegistrationFields(listRow, { includeRequestMeta: true })
          .filter((field) => !REGISTRATION_FIELDS_OMIT_IN_LIST.has(field.label))
          .map((field) => {
          const valueTruncate = registrationValueTruncateLabels.has(field.label)
            ? 'truncate whitespace-nowrap'
            : '';
          const labelClassName = REGISTRATION_FIELD_LABEL_NOWRAP.has(field.label)
            ? 'whitespace-nowrap'
            : '';
          if (field.label === '비고') {
            return (
              <Field
                key={field.label}
                className={registrationFieldCellClass}
                label={field.label}
                labelClassName={labelClassName}
              >
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
                  '-'
                )}
              </Field>
            );
          }
          const displayValue =
            field.value !== '' ? field.value : <span className="text-gray-400">-</span>;
          const textTitle =
            typeof field.value === 'string' && field.value !== '' && field.value !== '-'
              ? field.value
              : undefined;
          return (
            <Field
              key={field.label}
              className={registrationFieldCellClass}
              label={field.label}
              labelClassName={labelClassName}
              valueClassName={valueTruncate}
            >
              {typeof field.value === 'string' && registrationValueTruncateLabels.has(field.label) ? (
                <span className="truncate" title={textTitle}>
                  {displayValue}
                </span>
              ) : (
                displayValue
              )}
            </Field>
          );
        })}
      </div>

      <div
        className="flex flex-nowrap items-stretch gap-3 overflow-x-auto px-3 py-2.5 bg-white border-t border-slate-300"
        aria-label="생산 처리"
      >
        <Field
          className={`${planFieldCellClassRow} min-w-[6.75rem] flex-1 basis-0`}
          label="생산계획수량"
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
        </Field>
        <Field
          className={`${planFieldCellClassRow} min-w-[6.75rem] flex-1 basis-0`}
          label="완료예정일"
          valueClassName={
            isDateAfter(listRow.plannedCompletionDate, lineRequestedDate) ? 'text-red-500' : ''
          }
        >
          {listRow.plannedCompletionDate ? (
            formatDateShort(listRow.plannedCompletionDate)
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </Field>
        <Field
          className={`${planFieldCellClassRow} min-w-[5.5rem] flex-1 basis-0`}
          label="기계 No."
        >
          {listRow.machineNo?.trim() ? (
            listRow.machineNo.trim()
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </Field>
        {listRow.completionRounds.map((round, index) => {
          const display = formatProductionCompletionRoundDisplay(round);
          return (
            <Field
              key={`completion-round-${index + 1}`}
              className={`${completionFieldCellClassRow} min-w-[6.75rem] flex-1 basis-0`}
              label={`${index + 1}차 완료일 (수량)`}
            >
              {display === '-' ? <span className="text-gray-400">-</span> : display}
            </Field>
          );
        })}
        <Field
          className={`${completionFieldCellClassRow} min-w-[6.75rem] flex-1 basis-0`}
          label="UHP 세정/EP (수량)"
        >
          {(() => {
            const display = formatProductionCompletionRoundDisplay(listRow.cleaningEpCompletion);
            return display === '-' ? <span className="text-gray-400">-</span> : display;
          })()}
        </Field>
        <Field
          className={`${completionFieldCellClassRow} min-w-[6.75rem] flex-1 basis-0`}
          label="생산완료일 (수량)"
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
        </Field>
        <Field className={`${productionIssueFieldCellClassRow} min-w-[6.75rem] flex-1 basis-0`} label="생산 이슈">
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
        </Field>
      </div>
    </article>
  );
}
