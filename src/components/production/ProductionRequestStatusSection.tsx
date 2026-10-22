"use client";

import React from 'react';
import {
  buildProductionRequestRegistrationFields,
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

function Field({
  label,
  children,
  className = '',
  valueClassName = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-[11px] font-medium text-gray-500 leading-tight mb-0.5">{label}</div>
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
}: {
  listRow: ProductionRequestListRow;
  rowNumber: number;
  statusBadge: React.ReactNode;
  actions: React.ReactNode;
  onOpenMemo: () => void;
}) {
  const request = listRow.request;
  const lineRequestedDate = listRow.requestedCompletionDate ?? request.requestedCompletionDate;

  return (
    <article className="rounded-lg border border-slate-400 bg-white overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 border-b border-slate-300">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 rounded-md bg-slate-700 text-white text-xs font-semibold">
            {rowNumber}
          </span>
          <span className="text-sm font-semibold text-gray-900 truncate">{listRow.productName}</span>
          <span className="text-xs text-gray-500 truncate hidden sm:inline">{listRow.productCode}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {statusBadge}
          {actions}
        </div>
      </header>

      <div
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-x-3 gap-y-2 px-3 py-2.5 bg-sky-50/70 border-b border-slate-300"
        aria-label="생산요청 등록"
      >
        {buildProductionRequestRegistrationFields(listRow, { includeRequestMeta: true }).map((field) => {
          if (field.label === '제품명') {
            return (
              <Field key={field.label} label={field.label}>
                {listRow.productName}
                {request.itemName && listRow.productIndex === 0 && (
                  <span className="block text-xs text-gray-500 font-normal">({request.itemName})</span>
                )}
              </Field>
            );
          }
          if (field.label === '비고') {
            return (
              <Field key={field.label} label={field.label}>
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
          return (
            <Field key={field.label} label={field.label}>
              {field.value}
            </Field>
          );
        })}
      </div>

      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 px-3 py-2.5 bg-slate-100/90"
        aria-label="생산 처리"
      >
        <Field
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
          label="생산완료일"
          valueClassName={
            isDateAfter(request.actualCompletionDate, request.plannedCompletionDate) ? 'text-red-500' : ''
          }
        >
          {request.actualCompletionDate ? (
            formatDateShort(request.actualCompletionDate)
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </Field>
        <Field
          label="세정/EP 완료일"
          valueClassName={
            isDateAfter(request.cleaningEpCompletionDate, request.plannedCompletionDate)
              ? 'text-red-500'
              : ''
          }
        >
          {request.cleaningEpCompletionDate ? (
            formatDateShort(request.cleaningEpCompletionDate)
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </Field>
      </div>
    </article>
  );
}
