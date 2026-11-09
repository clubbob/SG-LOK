import { ProductionProductGroup, ProductionReason, ProductionRequest, ProductionSalesRegion } from '@/types';
import {
  expandProductionRequestsToListRows,
  formatProductionReasonLabel,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';

export const PRODUCTION_REQUEST_SEARCH_PLACEHOLDER = '검색어 입력';

export const ADMIN_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER = PRODUCTION_REQUEST_SEARCH_PLACEHOLDER;

export const USER_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER = PRODUCTION_REQUEST_SEARCH_PLACEHOLDER;

export type ProductionRequestPanelFilters = {
  productGroup: '' | ProductionProductGroup;
  productionReason: '' | ProductionReason;
  salesRegion: '' | ProductionSalesRegion;
  status: '' | string;
};

export const EMPTY_PRODUCTION_REQUEST_PANEL_FILTERS: ProductionRequestPanelFilters = {
  productGroup: '',
  productionReason: '',
  salesRegion: '',
  status: '',
};

/** 검색 패널 진행 상태 — 취소는 필터 옵션에서 제외 */
export function normalizeProductionRequestPanelStatusFilter(status: string | null | undefined): string {
  const s = (status ?? '').trim();
  if (!s || s === 'cancelled') return '';
  if (s === 'pending_review' || s === 'in_progress' || s === 'completed') return s;
  if (s === 'confirmed') return 'in_progress';
  return '';
}

export function productionRequestListRowMatchesPanelFilters(
  listRow: ProductionRequestListRow,
  filters: ProductionRequestPanelFilters
): boolean {
  if (filters.status) {
    const lineStatus = listRow.lineStatus;
    if (filters.status === 'in_progress') {
      if (lineStatus !== 'confirmed' && lineStatus !== 'in_progress') return false;
    } else if (lineStatus !== filters.status) {
      return false;
    }
  }

  if (filters.productionReason && listRow.productionReason !== filters.productionReason) {
    return false;
  }

  if (filters.productGroup) {
    const lineGroup = listRow.request.products?.[listRow.productIndex]?.productGroup?.trim() || '';
    if (lineGroup !== filters.productGroup) return false;
  }

  if (filters.salesRegion && listRow.salesRegion !== filters.salesRegion) {
    return false;
  }

  return true;
}

export function filterProductionListRows(
  requests: ProductionRequest[],
  searchQuery: string,
  filters: ProductionRequestPanelFilters,
  getLineStatusLabel: (listRow: ProductionRequestListRow) => string
): ProductionRequestListRow[] {
  const rows = expandProductionRequestsToListRows(requests);
  return rows.filter((row) => {
    if (!productionRequestListRowMatchesPanelFilters(row, filters)) return false;
    if (!productionRequestListRowMatchesSearch(row, searchQuery, getLineStatusLabel)) return false;
    return true;
  });
}

function salesRegionLabel(region?: ProductionRequest['salesRegion']): string {
  if (region === 'domestic') return '국내';
  if (region === 'overseas') return '해외';
  return '';
}

function buildListRowSearchableText(
  listRow: ProductionRequestListRow,
  getLineStatusLabel: (listRow: ProductionRequestListRow) => string
): string {
  const request = listRow.request;
  const productGroup =
    listRow.request.products?.[listRow.productIndex]?.productGroup?.trim() || '';
  const parts = [
    formatProductionReasonLabel(listRow.productionReason),
    listRow.productionReason,
    salesRegionLabel(listRow.salesRegion),
    listRow.salesRegion,
    productGroup,
    listRow.customerName,
    request.userName,
    request.userCompany,
    listRow.productName,
    listRow.productCode,
    listRow.machineNo,
    listRow.remark,
    getLineStatusLabel(listRow),
    listRow.lineStatus,
  ];
  return parts
    .filter((p) => p != null && String(p).trim() !== '')
    .join(' ')
    .toLowerCase();
}

function termMatchesListRow(
  listRow: ProductionRequestListRow,
  term: string,
  getLineStatusLabel: (listRow: ProductionRequestListRow) => string
): boolean {
  const haystack = buildListRowSearchableText(listRow, getLineStatusLabel);
  if (haystack.includes(term)) return true;

  if (term === '주문') return listRow.productionReason === 'order';
  if (term === '재고') return listRow.productionReason === 'inventory';
  if (term === '국내' || term === 'domestic') return listRow.salesRegion === 'domestic';
  if (term === '해외' || term === 'overseas') return listRow.salesRegion === 'overseas';

  return false;
}

export function productionRequestListRowMatchesSearch(
  listRow: ProductionRequestListRow,
  searchQuery: string,
  getLineStatusLabel: (listRow: ProductionRequestListRow) => string
): boolean {
  const term = searchQuery.trim().toLowerCase();
  if (!term) return true;

  return termMatchesListRow(listRow, term, getLineStatusLabel);
}
