import { ProductionRequest } from '@/types';
import { formatProductionReasonLabel } from '@/lib/production/productionRequestDisplay';

/** 등록 폼 입력 순서 (검색 가능 항목 안내) */
const SEARCH_FIELD_HINT_ADMIN =
  '주문/재고, 국내/해외, 고객사명, 제품명, 제품코드, 요청자, 상태';

const SEARCH_FIELD_HINT_USER =
  '주문/재고, 국내/해외, 고객사명, 제품명, 제품코드, 상태';

export const ADMIN_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER = `${SEARCH_FIELD_HINT_ADMIN} 검색...`;

export const USER_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER = `${SEARCH_FIELD_HINT_USER} 검색...`;

export const PRODUCTION_REQUEST_SEARCH_HELP =
  '복합 검색 방법 (예): 주문, 고객사명, 제품명, ...';

function salesRegionLabel(region?: ProductionRequest['salesRegion']): string {
  if (region === 'domestic') return '국내';
  if (region === 'overseas') return '해외';
  return '';
}

function productLinesSearchText(request: ProductionRequest): string {
  if (!request.products?.length) return '';
  return request.products
    .map((p) => {
      const reason = p.productionReason ?? request.productionReason;
      const region = p.salesRegion ?? request.salesRegion;
      const reasonLabel = formatProductionReasonLabel(reason);
      const regionLabel = salesRegionLabel(region);
      const customer = p.customerName ?? request.customerName;
      return [reasonLabel, reason, regionLabel, region, customer, p.productName, p.productCode, p.productNameCode, p.remark]
        .filter(Boolean)
        .join(' ');
    })
    .join(' ');
}

/** 한 요청에서 검색에 쓰는 전체 텍스트 */
function buildSearchableText(
  request: ProductionRequest,
  getStatusLabel: (request: ProductionRequest) => string
): string {
  const parts = [
    formatProductionReasonLabel(request.productionReason),
    request.productionReason,
    salesRegionLabel(request.salesRegion),
    request.salesRegion,
    request.customerName,
    request.userName,
    request.userCompany,
    request.productName,
    request.productCode,
    productLinesSearchText(request),
    getStatusLabel(request),
    request.status,
    request.memo,
  ];
  return parts
    .filter((p) => p != null && String(p).trim() !== '')
    .join(' ')
    .toLowerCase();
}

function parseSearchTerms(searchQuery: string): string[] {
  return searchQuery
    .split(/[,，]/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function termMatchesRequest(
  request: ProductionRequest,
  term: string,
  getStatusLabel: (request: ProductionRequest) => string
): boolean {
  const haystack = buildSearchableText(request, getStatusLabel);
  if (haystack.includes(term)) return true;

  const lineReasons = (request.products ?? []).map(
    (p) => p.productionReason ?? request.productionReason
  );
  const lineRegions = (request.products ?? []).map((p) => p.salesRegion ?? request.salesRegion);

  // 생산목적·국내/해외 축약 검색 (제품 줄·문서 루트)
  if (term === '주문') {
    if (request.productionReason === 'order') return true;
    if (lineReasons.some((r) => r === 'order')) return true;
  }
  if (term === '재고') {
    if (request.productionReason === 'inventory') return true;
    if (lineReasons.some((r) => r === 'inventory')) return true;
  }
  if (term === '국내' || term === 'domestic') {
    if (request.salesRegion === 'domestic') return true;
    if (lineRegions.some((r) => r === 'domestic')) return true;
  }
  if (term === '해외' || term === 'overseas') {
    if (request.salesRegion === 'overseas') return true;
    if (lineRegions.some((r) => r === 'overseas')) return true;
  }

  return false;
}

export function productionRequestMatchesSearch(
  request: ProductionRequest,
  searchQuery: string,
  getStatusLabel: (request: ProductionRequest) => string
): boolean {
  const raw = searchQuery.trim();
  if (!raw) return true;

  const hasComma = /[,，]/.test(raw);
  const terms = hasComma ? parseSearchTerms(raw) : [raw.toLowerCase()];

  if (terms.length === 0) return true;
  return terms.every((term) => termMatchesRequest(request, term, getStatusLabel));
}
