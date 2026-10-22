'use client';

import React from 'react';
import type { ProductionRequestPanelFilters } from '@/lib/production/productionRequestSearch';

const selectClass =
  'w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-9 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

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
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-semibold text-gray-800">{label}</span>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
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

  return (
    <section
      className="mb-6 rounded-xl border border-slate-300 bg-white p-4 sm:p-5 shadow-sm"
      aria-label="생산요청 검색"
    >
      <input
        type="search"
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      />

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/90 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

          <FilterSelect
            label="판매지역"
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

          <FilterSelect
            label="진행 상태"
            value={filters.status}
            onChange={(value) => onFiltersChange({ status: value })}
          >
            <option value="">전체</option>
            <option value="pending_review">승인 대기중</option>
            <option value="in_progress">진행중</option>
            <option value="completed">생산 완료</option>
            <option value="cancelled">취소</option>
          </FilterSelect>

          <div className="flex flex-col justify-end">
            <button
              type="button"
              onClick={resetAll}
              disabled={!hasActiveFilters}
              className="h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              조건 초기화
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
