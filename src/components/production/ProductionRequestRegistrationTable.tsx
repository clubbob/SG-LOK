'use client';

import React from 'react';
import type { ProductionRequestRegistrationField } from '@/lib/production/productionRequestDisplay';

const labelCell =
  'border border-gray-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap align-middle w-[7.25rem] sm:w-[7.75rem]';
const valueCell =
  'border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 align-middle break-words min-w-0';

function FieldValue({ field }: { field: ProductionRequestRegistrationField }) {
  if (field.multiline) {
    return <span className="whitespace-pre-wrap">{field.value || '-'}</span>;
  }
  return field.value !== '' ? field.value : '-';
}

type TableRow =
  | { kind: 'pair'; left: ProductionRequestRegistrationField; right?: ProductionRequestRegistrationField }
  | { kind: 'full'; field: ProductionRequestRegistrationField };

function buildTableRows(fields: ProductionRequestRegistrationField[]): TableRow[] {
  const rows: TableRow[] = [];
  let i = 0;
  while (i < fields.length) {
    const current = fields[i];
    const spanFull = current.label === '비고' || current.multiline;
    if (spanFull) {
      rows.push({ kind: 'full', field: current });
      i += 1;
      continue;
    }
    const next = fields[i + 1];
    if (next && next.label !== '비고' && !next.multiline) {
      rows.push({ kind: 'pair', left: current, right: next });
      i += 2;
    } else {
      rows.push({ kind: 'pair', left: current });
      i += 1;
    }
  }
  return rows;
}

export function ProductionRequestRegistrationTable({
  fields,
  caption,
}: {
  fields: ProductionRequestRegistrationField[];
  caption?: string;
}) {
  const rows = buildTableRows(fields);

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        {caption ? (
          <caption className="caption-top px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200 bg-gray-50">
            {caption}
          </caption>
        ) : null}
        <tbody>
          {rows.map((row, index) => {
            if (row.kind === 'full') {
              return (
                <tr key={`full-${row.field.label}`}>
                  <th scope="row" className={labelCell}>{row.field.label}</th>
                  <td colSpan={3} className={valueCell}>
                    <FieldValue field={row.field} />
                  </td>
                </tr>
              );
            }
            if (!row.right) {
              return (
                <tr key={`pair-${index}-${row.left.label}`}>
                  <th scope="row" className={labelCell}>{row.left.label}</th>
                  <td colSpan={3} className={valueCell}>
                    <FieldValue field={row.left} />
                  </td>
                </tr>
              );
            }
            return (
              <tr key={`pair-${index}-${row.left.label}`}>
                <th scope="row" className={labelCell}>{row.left.label}</th>
                <td className={valueCell}>
                  <FieldValue field={row.left} />
                </td>
                <th scope="row" className={labelCell}>{row.right.label}</th>
                <td className={valueCell}>
                  <FieldValue field={row.right} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
