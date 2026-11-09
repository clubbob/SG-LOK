'use client';

import React from 'react';
import {
  PRODUCTION_REQUEST_LIST_VIEW_TABS,
  type ProductionRequestListViewTab,
} from '@/lib/production/productionRequestListView';

export function ProductionRequestListViewTabs({
  value,
  onChange,
  hideCompleted,
  onHideCompletedChange,
}: {
  value: ProductionRequestListViewTab;
  onChange: (tab: ProductionRequestListViewTab) => void;
  hideCompleted: boolean;
  onHideCompletedChange: (hide: boolean) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
      <nav
        className="flex flex-wrap gap-1 min-w-0"
        aria-label="생산요청 목록 보기"
        role="tablist"
      >
        {PRODUCTION_REQUEST_LIST_VIEW_TABS.map((tab) => {
          const selected = value === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={[
                '-mb-px rounded-t-lg border px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap',
                selected
                  ? 'border-slate-300 border-b-white bg-white text-blue-700 shadow-sm'
                  : 'border-transparent bg-transparent text-gray-600 hover:bg-slate-50 hover:text-gray-900',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
      <label className="mb-2 flex cursor-pointer items-center gap-2 shrink-0 select-none">
        <input
          type="checkbox"
          checked={hideCompleted}
          onChange={(e) => onHideCompletedChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
        />
        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">생산완료 제외</span>
      </label>
    </div>
  );
}
