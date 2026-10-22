import { ProductionReason, ProductionRequest, ProductionSalesRegion } from '@/types';
import {
  expandProductionRequestsToListRows,
  formatProductionReasonLabel,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';

/** 등록 폼 입력 순서 (검색 가능 항목 안내) */
const SEARCH_FIELD_HINT_ADMIN =
  '주문/재고, 국내/해외, 고객사명, 제품명, 제품코드, 요청자, 상태';

const SEARCH_FIELD_HINT_USER =
  '주문/재고, 국내/해외, 고객사명, 제품명, 제품코드, 상태';

export const ADMIN_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER = `${SEARCH_FIELD_HINT_ADMIN} 검색...`;

export const USER_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER = `${SEARCH_FIELD_HINT_USER} 검색...`;

export type ProductionRequestPanelFilters = {
  productionReason: '' | ProductionReason;
  salesRegion: '' | ProductionSalesRegion;
  status: '' | string;
};

export const EMPTY_PRODUCTION_REQUEST_PANEL_FILTERS: ProductionRequestPanelFilters = {
  productionReason: '',
  salesRegion: '',
  status: '',
};

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
  const parts = [
    formatProductionReasonLabel(listRow.productionReason),
    listRow.productionReason,
    salesRegionLabel(listRow.salesRegion),
    listRow.salesRegion,
    listRow.customerName,
    request.userName,
    request.userCompany,
    listRow.productName,
    listRow.productCode,
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
