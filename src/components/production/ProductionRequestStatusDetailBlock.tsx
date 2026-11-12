'use client';

import React from 'react';
import {
  buildProductionRequestRegistrationFields,
  formatProductionCompletionRoundDisplay,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';
import { formatDateShort } from '@/lib/utils';
import {
  LIST_DETAIL_INNER_COLGROUP,
  listCompletionTdClass,
  listCompletionThClass,
  listPlanTdClass,
  listProductionIssueTdClass,
  listRegistrationTdClass,
  listRegistrationThClass,
} from '@/components/production/productionRequestStatusTableStyles';

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
  '도면',
]);

const REGISTRATION_FIELDS_OMIT_IN_LIST = new Set(['제품군', '제품명', '제품코드']);
const registrationValueTruncateLabels = new Set(['고객사명', '비고']);

function TableHeadingCell({
  children,
  className,
  nowrap = true,
  align = 'center',
  allowShrink = true,
}: {
  children: React.ReactNode;
  className: string;
  nowrap?: boolean;
  align?: 'center' | 'left';
  /** false: 완료일(수량) 등 한 줄 표시용 */
  allowShrink?: boolean;
}) {
  const titleText = typeof children === 'string' ? children : undefined;
  const alignClass = align === 'left' ? 'text-left' : 'text-center';
  return (
    <th
      scope="col"
      className={`${className} ${alignClass} font-semibold ${allowShrink ? 'max-w-0' : ''}`}
    >
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
  align = 'center',
}: {
  children: React.ReactNode;
  className: string;
  valueClassName?: string;
  align?: 'center' | 'left';
}) {
  const alignClass = align === 'left' ? 'text-left' : 'text-center';
  return (
    <td className={`${className} ${alignClass}`}>
      <div className={`min-w-0 leading-snug ${alignClass} ${valueClassName}`}>{children}</div>
    </td>
  );
}

export function ProductionRequestStatusDetailBlock({
  listRow,
  onOpenMemo,
  onOpenProductionIssue,
}: {
  listRow: ProductionRequestListRow;
  onOpenMemo: () => void;
  onOpenProductionIssue?: () => void;
}) {
  const request = listRow.request;
  const lineRequestedDate = listRow.requestedCompletionDate ?? request.requestedCompletionDate;
  const productionIssueText = listRow.productionIssue?.trim() ?? '';

  const registrationFields = buildProductionRequestRegistrationFields(listRow, {
    includeRequestMeta: true,
  }).filter((field) => !REGISTRATION_FIELDS_OMIT_IN_LIST.has(field.label));

  const registrationColumnCount = registrationFields.length;
  const productionHeadings: { label: string; tdClass: string }[] = [
    { label: '생산계획수량', tdClass: listPlanTdClass },
    { label: '완료예정일', tdClass: listPlanTdClass },
    { label: '기계명', tdClass: listPlanTdClass },
    ...listRow.completionRounds.map((_, index) => ({
      label: `${index + 1}차 완료일 (수량)`,
      tdClass: listCompletionTdClass,
    })),
    { label: 'UHP 세정/EP (수량)', tdClass: listCompletionTdClass },
    { label: '생산완료일 (수량)', tdClass: listCompletionTdClass },
    { label: '생산 이슈', tdClass: listProductionIssueTdClass },
  ];

  return (
    <table className="w-full min-w-[64rem] table-auto border-collapse border border-slate-400 text-center">
      {LIST_DETAIL_INNER_COLGROUP}
      <tbody>
        <tr aria-label="생산요청 등록 항목">
          {registrationFields.map((field) => (
            <TableHeadingCell
              key={`reg-h-${field.label}`}
              className={listRegistrationThClass}
              nowrap={REGISTRATION_FIELD_LABEL_NOWRAP.has(field.label)}
              align="center"
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

            if (field.label === '도면') {
              const links =
                field.drawingLinks && field.drawingLinks.length > 0
                  ? field.drawingLinks
                  : field.href && field.value !== '-'
                    ? [{ name: field.value, href: field.href }]
                    : [];
              return (
                <TableValueCell
                  key={`reg-v-${field.label}`}
                  className={listRegistrationTdClass}
                  align="left"
                >
                  {links.length > 0 ? (
                    <ul className="space-y-0.5 text-left">
                      {links.map((link) => (
                        <li key={link.href}>
                          <a
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium truncate block max-w-full"
                            title={link.name}
                          >
                            {link.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </TableValueCell>
              );
            }

            if (field.label === '비고') {
              return (
                <TableValueCell
                  key={`reg-v-${field.label}`}
                  className={listRegistrationTdClass}
                  align="left"
                >
                  {listRow.remark?.trim() ? (
                    <div className="flex items-center justify-start gap-1.5 min-w-0">
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
                className={listRegistrationTdClass}
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
          {productionHeadings.map((col) => {
            const isCompletionCol =
              col.label.includes('완료일') || col.label.includes('세정/EP');
            return (
              <TableHeadingCell
                key={`prod-h-${col.label}`}
                className={isCompletionCol ? listCompletionThClass : listRegistrationThClass}
                align="center"
                allowShrink={!isCompletionCol}
              >
                {col.label}
              </TableHeadingCell>
            );
          })}
          {productionHeadings.length < registrationColumnCount
            ? Array.from({ length: registrationColumnCount - productionHeadings.length }, (_, i) => (
                <th
                  key={`prod-h-pad-${i}`}
                  scope="col"
                  className={`${listRegistrationThClass} text-center font-semibold whitespace-nowrap`}
                  aria-hidden
                />
              ))
            : null}
        </tr>
        <tr aria-label="생산 처리 내용">
          <TableValueCell
            className={listPlanTdClass}
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
            className={listPlanTdClass}
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
          <TableValueCell className={listPlanTdClass}>
            {listRow.machineNo?.trim() ? (
              listRow.machineNo.trim()
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </TableValueCell>
          {listRow.completionRounds.map((round, index) => {
            const display = formatProductionCompletionRoundDisplay(round);
            return (
              <TableValueCell key={`prod-v-round-${index + 1}`} className={listCompletionTdClass}>
                {display === '-' ? <span className="text-gray-400">-</span> : display}
              </TableValueCell>
            );
          })}
          <TableValueCell className={listCompletionTdClass}>
            {(() => {
              const display = formatProductionCompletionRoundDisplay(listRow.cleaningEpCompletion);
              return display === '-' ? <span className="text-gray-400">-</span> : display;
            })()}
          </TableValueCell>
          <TableValueCell
            className={listCompletionTdClass}
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
          <TableValueCell className={listProductionIssueTdClass} align="left">
            {productionIssueText ? (
              <div className="flex items-center justify-start gap-1.5 min-w-0">
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
          {productionHeadings.length < registrationColumnCount
            ? Array.from({ length: registrationColumnCount - productionHeadings.length }, (_, i) => (
                <td
                  key={`prod-v-pad-${i}`}
                  className={listRegistrationTdClass}
                  aria-hidden
                />
              ))
            : null}
        </tr>
      </tbody>
    </table>
  );
}
