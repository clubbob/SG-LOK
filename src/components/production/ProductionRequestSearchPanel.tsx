'use client';

import React from 'react';
import type { ProductionRequestPanelFilters } from '@/lib/production/productionRequestSearch';

const selectClass =
  'h-10 w-full min-w-0 appearance-none rounded-lg border border-slate-300 bg-white pl-2.5 pr-8 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

const searchInputClass =
  'h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex w-full min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs font-semibold text-gray-800 whitespace-nowrap">{label}</span>
      <div className="relative min-w-0 flex-1">
        <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </label>
  );
}

export function ProductionRequestSearchPanel({
  searchQuery,
  onSearchQueryChange,
  placeholder,
  filters,
  onFiltersChange,
}: {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  placeholder: string;
  filters: ProductionRequestPanelFilters;
  onFiltersChange: (patch: Partial<ProductionRequestPanelFilters>) => void;
}) {
  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(filters.productionReason) ||
    Boolean(filters.salesRegion) ||
    Boolean(filters.status);

  const resetAll = () => {
    onSearchQueryChange('');
    onFiltersChange({
      productionReason: '',
      salesRegion: '',
      status: '',
    });
  };

  const cellClass = 'min-w-0 flex-1 basis-0';

  return (
    <section
      className="mb-6 rounded-xl border border-slate-300 bg-white p-3 sm:p-4 shadow-sm"
      aria-label="생산요청 검색"
    >
      <div className="flex flex-nowrap items-center gap-4 sm:gap-5 lg:gap-6 overflow-x-auto pb-0.5">
        <div className={`${cellClass} min-w-[8.5rem]`}>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={placeholder}
            className={searchInputClass}
          />
        </div>

        <div className={`${cellClass} min-w-[9.5rem]`}>
          <FilterSelect
            label="생산목적"
            value={filters.productionReason}
            onChange={(value) =>
              onFiltersChange({
                productionReason: value as ProductionRequestPanelFilters['productionReason'],
              })
            }
          >
            <option value="">전체</option>
            <option value="order">주문</option>
            <option value="inventory">재고</option>
          </FilterSelect>
        </div>

        <div className={`${cellClass} min-w-[8.5rem]`}>
          <FilterSelect
            label="지역"
            value={filters.salesRegion}
            onChange={(value) =>
              onFiltersChange({
                salesRegion: value as ProductionRequestPanelFilters['salesRegion'],
              })
            }
          >
            <option value="">전체</option>
            <option value="domestic">국내</option>
            <option value="overseas">해외</option>
          </FilterSelect>
        </div>

        <div className={`${cellClass} min-w-[10.5rem]`}>
          <FilterSelect
            label="진행 상태"
            value={filters.status}
            onChange={(value) => onFiltersChange({ status: value })}
          >
            <option value="">전체</option>
            <option value="pending_review">승인 대기중</option>
            <option value="in_progress">진행중</option>
            <option value="completed">생산 완료</option>
          </FilterSelect>
        </div>

        <div className={`${cellClass} min-w-[6.5rem] shrink-0`}>
          <button
            type="button"
            onClick={resetAll}
            disabled={!hasActiveFilters}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 sm:px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
          >
            조건 초기화
          </button>
        </div>
      </div>
    </section>
  );
}
