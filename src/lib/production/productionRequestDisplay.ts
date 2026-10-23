import { Timestamp, type DocumentData } from 'firebase/firestore';
import {
  CertificateProduct,
  ProductionReason,
  ProductionRequest,
  ProductionRequestStatus,
  ProductionSalesRegion,
} from '@/types';
import { formatDateShort } from '@/lib/utils';

/** 생산요청 등록 폼(RequestProductLinesSection)과 동일한 항목·순서 */
export type ProductionRequestRegistrationField = {
  label: string;
  value: string;
  multiline?: boolean;
};

export type ProductionRequestListRow = {
  rowKey: string;
  request: ProductionRequest;
  productIndex: number;
  productName: string;
  productCode: string;
  productionReason: ProductionReason;
  salesRegion?: ProductionSalesRegion;
  customerName?: string;
  orderQuantity: number | null;
  requestQuantity: number | null;
  requestedCompletionDate?: Date;
  lineStatus: ProductionRequestStatus;
  plannedQuantity: number | null;
  plannedCompletionDate?: Date;
  /** 1~3차 부분 완료 (날짜·수량) */
  completionRounds: ProductionCompletionRound[];
  actualCompletion: ProductionCompletionRound;
  remark?: string;
};

export type ProductionCompletionRound = {
  date?: Date;
  quantity?: number | null;
};

export const PRODUCTION_COMPLETION_ROUND_COUNT = 3;

const COMPLETION_ROUND_FIELD_NAMES: {
  date: keyof CertificateProduct;
  quantity: keyof CertificateProduct;
}[] = [
  { date: 'completionRound1Date', quantity: 'completionRound1Quantity' },
  { date: 'completionRound2Date', quantity: 'completionRound2Quantity' },
  { date: 'completionRound3Date', quantity: 'completionRound3Quantity' },
];

const COMPLETION_ROUND_REQUEST_KEYS: {
  date: keyof ProductionRequest;
  quantity: keyof ProductionRequest;
}[] = [
  { date: 'completionRound1Date', quantity: 'completionRound1Quantity' },
  { date: 'completionRound2Date', quantity: 'completionRound2Quantity' },
  { date: 'completionRound3Date', quantity: 'completionRound3Quantity' },
];

export function lineCompletionRound(
  product: CertificateProduct | undefined,
  request: ProductionRequest,
  multiProduct: boolean,
  roundIndex: number
): ProductionCompletionRound {
  const keys = COMPLETION_ROUND_FIELD_NAMES[roundIndex];
  const reqKeys = COMPLETION_ROUND_REQUEST_KEYS[roundIndex];
  if (!keys || !reqKeys) return {};

  const fromProductDate = firestoreDateToDate(product?.[keys.date]);
  const fromProductQty = product?.[keys.quantity];
  const quantity =
    typeof fromProductQty === 'number' && !Number.isNaN(fromProductQty) ? fromProductQty : null;

  if (fromProductDate != null || quantity != null) {
    return { date: fromProductDate, quantity };
  }

  if (!multiProduct) {
    const fromReqDate = firestoreDateToDate(request[reqKeys.date]);
    const fromReqQty = request[reqKeys.quantity];
    const reqQuantity =
      typeof fromReqQty === 'number' && !Number.isNaN(fromReqQty) ? fromReqQty : null;
    return { date: fromReqDate, quantity: reqQuantity };
  }

  return {};
}

export function formatProductionCompletionRoundDisplay(round: ProductionCompletionRound): string {
  const hasDate = round.date != null && !Number.isNaN(round.date.getTime());
  const hasQty = round.quantity != null;
  if (!hasDate && !hasQty) return '-';
  const dateStr = hasDate ? formatDateShort(round.date!) : '-';
  const qtyStr = hasQty ? round.quantity!.toLocaleString('ko-KR') : '-';
  return `${dateStr} (${qtyStr})`;
}

export type ProductionCompletionRoundFormFields = {
  completionRound1Date: string;
  completionRound1Quantity: string;
  completionRound2Date: string;
  completionRound2Quantity: string;
  completionRound3Date: string;
  completionRound3Quantity: string;
};

export const EMPTY_COMPLETION_ROUND_FORM: ProductionCompletionRoundFormFields = {
  completionRound1Date: '',
  completionRound1Quantity: '',
  completionRound2Date: '',
  completionRound2Quantity: '',
  completionRound3Date: '',
  completionRound3Quantity: '',
};

export function completionRoundFormFromLine(
  product: CertificateProduct | undefined,
  request: ProductionRequest,
  multiProduct: boolean
): ProductionCompletionRoundFormFields {
  const out = { ...EMPTY_COMPLETION_ROUND_FORM };
  for (let i = 0; i < PRODUCTION_COMPLETION_ROUND_COUNT; i++) {
    const round = lineCompletionRound(product, request, multiProduct, i);
    const n = i + 1;
    const dateKey = `completionRound${n}Date` as keyof ProductionCompletionRoundFormFields;
    const qtyKey = `completionRound${n}Quantity` as keyof ProductionCompletionRoundFormFields;
    out[dateKey] = round.date ? firestoreValueToDateInputString(round.date) : '';
    out[qtyKey] =
      round.quantity != null && !Number.isNaN(round.quantity) ? String(round.quantity) : '';
  }
  return out;
}

function applySingleCompletionRoundToProduct(
  product: CertificateProduct,
  round: 1 | 2 | 3,
  dateStr: string,
  qtyStr: string
): void {
  const dateKey =
    round === 1 ? 'completionRound1Date' : round === 2 ? 'completionRound2Date' : 'completionRound3Date';
  const qtyKey =
    round === 1
      ? 'completionRound1Quantity'
      : round === 2
        ? 'completionRound2Quantity'
        : 'completionRound3Quantity';

  if (dateStr) {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) {
      product[dateKey] = d;
    } else {
      delete product[dateKey];
    }
  } else {
    delete product[dateKey];
  }

  if (qtyStr) {
    const q = parseInt(qtyStr, 10);
    if (!Number.isNaN(q) && q >= 0) {
      product[qtyKey] = q;
    } else {
      delete product[qtyKey];
    }
  } else {
    delete product[qtyKey];
  }
}

export function applyCompletionRoundFormToProduct(
  product: CertificateProduct,
  form: ProductionCompletionRoundFormFields
): CertificateProduct {
  const next: CertificateProduct = { ...product };
  for (let i = 0; i < PRODUCTION_COMPLETION_ROUND_COUNT; i++) {
    const n = (i + 1) as 1 | 2 | 3;
    const dateStr = form[`completionRound${n}Date` as keyof ProductionCompletionRoundFormFields]?.trim() ?? '';
    const qtyStr =
      form[`completionRound${n}Quantity` as keyof ProductionCompletionRoundFormFields]?.trim() ?? '';
    applySingleCompletionRoundToProduct(next, n, dateStr, qtyStr);
  }
  return next;
}

export function completionRoundRootPatchFromProduct(
  product: CertificateProduct
): Record<string, Timestamp | number | null> {
  const patch: Record<string, Timestamp | number | null> = {};
  for (const keys of COMPLETION_ROUND_FIELD_NAMES) {
    const dateVal = product[keys.date];
    const d = dateVal instanceof Date ? dateVal : firestoreDateToDate(dateVal);
    patch[keys.date] = d && !Number.isNaN(d.getTime()) ? Timestamp.fromDate(d) : null;
    const qty = product[keys.quantity];
    patch[keys.quantity] =
      typeof qty === 'number' && !Number.isNaN(qty) ? qty : null;
  }
  return patch;
}

export function lineProductionReason(
  product: CertificateProduct | undefined,
  request: ProductionRequest
): ProductionReason {
  if (product?.productionReason === 'order' || product?.productionReason === 'inventory') {
    return product.productionReason;
  }
  return request.productionReason;
}

export function lineSalesRegion(
  product: CertificateProduct | undefined,
  request: ProductionRequest
): ProductionSalesRegion | undefined {
  if (product?.salesRegion === 'domestic' || product?.salesRegion === 'overseas') {
    return product.salesRegion;
  }
  return request.salesRegion;
}

export function lineCustomerName(
  product: CertificateProduct | undefined,
  request: ProductionRequest
): string | undefined {
  if (lineProductionReason(product, request) === 'inventory') {
    const name = product?.customerName?.trim();
    return name || undefined;
  }
  const name = product?.customerName?.trim() || request.customerName?.trim();
  return name || undefined;
}

export function formatProductionReasonLabel(reason?: ProductionReason | string): string {
  if (reason === 'order') return '주문';
  if (reason === 'inventory') return '재고';
  return '-';
}

export function formatProductionSalesRegionLabel(region?: ProductionSalesRegion | string): string {
  if (region === 'domestic') return '국내';
  if (region === 'overseas') return '해외';
  return '-';
}

function lineProductGroup(product: CertificateProduct | undefined): string {
  return product?.productGroup?.trim() || '';
}

/** 승인·상세 등에서 등록 폼과 같은 라벨·순서로 표시 */
export function buildProductionRequestRegistrationFields(
  listRow: ProductionRequestListRow,
  options?: { includeRequestMeta?: boolean }
): ProductionRequestRegistrationField[] {
  const { request } = listRow;
  const product = request.products?.[listRow.productIndex];
  const isOrder = listRow.productionReason === 'order';
  const completionDate =
    listRow.requestedCompletionDate ?? request.requestedCompletionDate;
  const remark = listRow.remark?.trim() ?? '';

  const fields: ProductionRequestRegistrationField[] = [];

  if (options?.includeRequestMeta) {
    fields.push({ label: '요청자', value: request.userName?.trim() || '-' });
    fields.push({
      label: '요청일',
      value: request.requestDate ? formatDateShort(request.requestDate) : '-',
    });
  }

  fields.push({
    label: '생산목적',
    value: formatProductionReasonLabel(listRow.productionReason),
  });
  fields.push({
    label: '국내/해외',
    value: formatProductionSalesRegionLabel(listRow.salesRegion),
  });
  fields.push({
    label: '고객사명',
    value: isOrder ? listRow.customerName?.trim() || '-' : '',
  });
  fields.push({
    label: '제품군',
    value: lineProductGroup(product) || '-',
  });
  fields.push({ label: '제품명', value: listRow.productName || '-' });
  fields.push({ label: '제품코드', value: listRow.productCode || '-' });
  fields.push({
    label: '수주수량',
    value:
      isOrder && listRow.orderQuantity != null
        ? listRow.orderQuantity.toLocaleString('ko-KR')
        : '',
  });
  fields.push({
    label: '생산요청수량',
    value:
      listRow.requestQuantity != null ? listRow.requestQuantity.toLocaleString('ko-KR') : '-',
  });
  fields.push({
    label: '완료요청일',
    value: completionDate ? formatDateShort(completionDate) : '-',
  });
  fields.push({
    label: '비고',
    value: remark || '-',
    multiline: remark.includes('\n'),
  });

  return fields;
}

/** Firestore·레거시 status → 표준 값 */
export function normalizeProductionRequestStatus(status: unknown): ProductionRequest['status'] {
  if (status === 'pending') return 'pending_review';
  if (
    status === 'pending_review' ||
    status === 'confirmed' ||
    status === 'in_progress' ||
    status === 'completed' ||
    status === 'cancelled'
  ) {
    return status;
  }
  return 'pending_review';
}

/** 승인·저장 시 제품 배열 병합 — 줄별 lineStatus·계획 필드 유지 */
export function mergeProductionProductsPreservingLineMeta(
  previous: CertificateProduct[],
  fromLines: CertificateProduct[]
): CertificateProduct[] {
  return fromLines.map((row, i) => {
    const old = previous[i];
    if (!old) return row;
    const merged: CertificateProduct = {
      ...old,
      ...row,
      lineStatus: old.lineStatus ?? row.lineStatus,
      plannedQuantity: old.plannedQuantity ?? row.plannedQuantity,
      plannedCompletionDate: old.plannedCompletionDate ?? row.plannedCompletionDate,
    };
    if (old.completionRound1Date != null) merged.completionRound1Date = old.completionRound1Date;
    if (old.completionRound1Quantity != null) merged.completionRound1Quantity = old.completionRound1Quantity;
    if (old.completionRound2Date != null) merged.completionRound2Date = old.completionRound2Date;
    if (old.completionRound2Quantity != null) merged.completionRound2Quantity = old.completionRound2Quantity;
    if (old.completionRound3Date != null) merged.completionRound3Date = old.completionRound3Date;
    if (old.completionRound3Quantity != null) merged.completionRound3Quantity = old.completionRound3Quantity;
    if (old.actualCompletionDate != null) merged.actualCompletionDate = old.actualCompletionDate;
    if (old.actualCompletionQuantity != null) merged.actualCompletionQuantity = old.actualCompletionQuantity;
    return merged;
  });
}

/** 확정·진행·완료·취소 이후에는 제품·요청 내용 수정 불가 (사용자 화면) */
export function isProductionRequestContentEditable(status?: string): boolean {
  if (status === '' || status == null) return true;
  return normalizeProductionRequestStatus(status) === 'pending_review';
}

export function firestoreValueToDateInputString(value: unknown): string {
  const d = firestoreDateToDate(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

export function firestoreDateToDate(value: unknown): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toDate === 'function') {
      try {
        const d = obj.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
      } catch {
        // 직렬화·부분 Timestamp 등 toDate 실패 시 seconds로 폴백
      }
    }
    const seconds =
      typeof obj.seconds === 'number'
        ? obj.seconds
        : typeof obj._seconds === 'number'
          ? obj._seconds
          : undefined;
    if (seconds != null) {
      const d = new Date(seconds * 1000);
      return Number.isNaN(d.getTime()) ? undefined : d;
    }
  }
  return undefined;
}

function productLineCompletionDate(
  product: CertificateProduct,
  request: ProductionRequest
): Date | undefined {
  return firestoreDateToDate(product.requestedCompletionDate) ?? request.requestedCompletionDate;
}

export function lineActualCompletion(
  product: CertificateProduct | undefined,
  productIndex: number,
  request: ProductionRequest,
  multiProduct: boolean
): ProductionCompletionRound {
  const fromProductDate = firestoreDateToDate(product?.actualCompletionDate);
  const fromProductQty = product?.actualCompletionQuantity;
  const productQty =
    typeof fromProductQty === 'number' && !Number.isNaN(fromProductQty) ? fromProductQty : null;

  if (fromProductDate != null || productQty != null) {
    return { date: fromProductDate, quantity: productQty };
  }

  if (!multiProduct) {
    return {
      date: firestoreDateToDate(request.actualCompletionDate),
      quantity:
        typeof request.actualCompletionQuantity === 'number' &&
        !Number.isNaN(request.actualCompletionQuantity)
          ? request.actualCompletionQuantity
          : null,
    };
  }

  const products = request.products ?? [];
  const docDate = firestoreDateToDate(request.actualCompletionDate);
  if (docDate && products.some((p) => firestoreDateToDate(p.actualCompletionDate))) {
    return {};
  }
  if (docDate) {
    const completedLineIndexes = products
      .map((p, i) => (normalizeProductionRequestStatus(p.lineStatus ?? '') === 'completed' ? i : -1))
      .filter((i) => i >= 0);
    if (completedLineIndexes.length === 1 && completedLineIndexes[0] === productIndex) {
      return {
        date: docDate,
        quantity:
          typeof request.actualCompletionQuantity === 'number' &&
          !Number.isNaN(request.actualCompletionQuantity)
            ? request.actualCompletionQuantity
            : null,
      };
    }
  }

  return {};
}

/** 다중 제품 문서에서 줄별 상태 (미승인 줄은 대기중) */
export function resolveProductionLineStatus(
  product: CertificateProduct | undefined,
  productIndex: number,
  request: ProductionRequest,
  multiProduct: boolean
): ProductionRequestStatus {
  if (lineActualCompletion(product, productIndex, request, multiProduct).date) {
    return 'completed';
  }
  if (product?.lineStatus) {
    let status = normalizeProductionRequestStatus(product.lineStatus);
    if (multiProduct && status === 'completed') {
      status = 'in_progress';
    }
    return status;
  }
  if (multiProduct && request.status === 'pending_review') {
    return 'pending_review';
  }
  const docStatus = normalizeProductionRequestStatus(request.status);
  if (!multiProduct && docStatus === 'completed') {
    return 'completed';
  }
  return docStatus;
}

export function deriveProductionRequestStatusFromProducts(
  products: CertificateProduct[]
): ProductionRequestStatus {
  if (!products.length) return 'pending_review';

  const lineStatuses = products.map((p) => {
    if (firestoreDateToDate(p.actualCompletionDate)) return 'completed' as const;
    return normalizeProductionRequestStatus(p.lineStatus ?? 'pending_review');
  });

  if (lineStatuses.every((s) => s === 'completed')) return 'completed';
  if (lineStatuses.some((s) => s === 'pending_review')) return 'pending_review';
  if (lineStatuses.some((s) => s === 'confirmed' || s === 'in_progress')) {
    return 'in_progress';
  }
  return 'confirmed';
}

function linePlannedQuantity(
  product: CertificateProduct | undefined,
  request: ProductionRequest,
  multiProduct: boolean
): number | null {
  if (product?.plannedQuantity != null) return product.plannedQuantity;
  if (!multiProduct && request.plannedQuantity != null) return request.plannedQuantity;
  return null;
}

function linePlannedCompletionDate(
  product: CertificateProduct | undefined,
  request: ProductionRequest,
  multiProduct: boolean
): Date | undefined {
  const fromProduct = firestoreDateToDate(product?.plannedCompletionDate);
  if (fromProduct) return fromProduct;
  if (!multiProduct) return request.plannedCompletionDate;
  return undefined;
}

/** 관리자 승인: 선택한 목록 줄(제품)만 반영 */
export function buildProductionRequestLineApprovalPatch(
  listRow: ProductionRequestListRow,
  approval: {
    plannedQuantity: number;
    plannedCompletionDate: Date;
    adminMemo?: string | null;
  }
): Record<string, unknown> {
  const request = listRow.request;
  const productIndex = listRow.productIndex;
  const products = request.products;

  const base: Record<string, unknown> = {
    updatedAt: Timestamp.now(),
    updatedBy: 'admin',
  };
  if (approval.adminMemo !== undefined) {
    base.adminMemo = approval.adminMemo;
  }

  if (!products?.length) {
    return {
      ...base,
      status: 'confirmed',
      plannedQuantity: approval.plannedQuantity,
      plannedCompletionDate: Timestamp.fromDate(approval.plannedCompletionDate),
    };
  }

  const updatedProducts = products.map((p, i) => {
    if (i !== productIndex) return p;
    return {
      ...p,
      lineStatus: 'confirmed' as ProductionRequestStatus,
      plannedQuantity: approval.plannedQuantity,
      plannedCompletionDate: approval.plannedCompletionDate,
    };
  });

  const allConfirmed = updatedProducts.every(
    (p) => normalizeProductionRequestStatus(p.lineStatus) === 'confirmed'
  );

  const patch: Record<string, unknown> = {
    ...base,
    products: updatedProducts,
    status: allConfirmed ? 'confirmed' : 'pending_review',
  };

  if (products.length === 1) {
    patch.plannedQuantity = approval.plannedQuantity;
    patch.plannedCompletionDate = Timestamp.fromDate(approval.plannedCompletionDate);
  }

  return patch;
}

/** 목록·엑셀: 제품 1개 = 1행 */
export function expandProductionRequestsToListRows(
  requests: ProductionRequest[]
): ProductionRequestListRow[] {
  const rows: ProductionRequestListRow[] = [];
  for (const request of requests) {
    if (request.products?.length) {
      const multiProduct = request.products.length > 1;
      request.products.forEach((product, productIndex) => {
        const reason = lineProductionReason(product, request);
        rows.push({
          rowKey: `${request.id}-${productIndex}`,
          request,
          productIndex,
          productName: product.productName || '-',
          productCode: product.productCode || '-',
          productionReason: reason,
          salesRegion: lineSalesRegion(product, request),
          customerName: lineCustomerName(product, request),
          orderQuantity:
            reason === 'order' && product.orderQuantity != null ? product.orderQuantity : null,
          requestQuantity: product.quantity != null ? product.quantity : null,
          requestedCompletionDate: productLineCompletionDate(product, request),
          lineStatus: resolveProductionLineStatus(product, productIndex, request, multiProduct),
          plannedQuantity: linePlannedQuantity(product, request, multiProduct),
          plannedCompletionDate: linePlannedCompletionDate(product, request, multiProduct),
          completionRounds: Array.from({ length: PRODUCTION_COMPLETION_ROUND_COUNT }, (_, i) =>
            lineCompletionRound(product, request, multiProduct, i)
          ),
          actualCompletion: lineActualCompletion(product, productIndex, request, multiProduct),
          remark: product.remark?.trim() || (productIndex === 0 ? request.memo : undefined),
        });
      });
    } else {
      rows.push({
        rowKey: `${request.id}-0`,
        request,
        productIndex: 0,
        productName: request.productName || '-',
        productCode: request.productCode || '-',
        productionReason: request.productionReason,
        salesRegion: request.salesRegion,
        customerName: request.customerName,
        orderQuantity:
          request.productionReason === 'order' ? request.orderQuantity ?? null : null,
        requestQuantity: request.quantity ?? null,
        requestedCompletionDate: request.requestedCompletionDate,
        lineStatus: resolveProductionLineStatus(undefined, 0, request, false),
        plannedQuantity: request.plannedQuantity ?? null,
        plannedCompletionDate: request.plannedCompletionDate,
        completionRounds: Array.from({ length: PRODUCTION_COMPLETION_ROUND_COUNT }, (_, i) =>
          lineCompletionRound(undefined, request, false, i)
        ),
        actualCompletion: lineActualCompletion(undefined, 0, request, false),
        remark: request.memo,
      });
    }
  }
  return rows;
}

export type ProductionDashboardStats = {
  total: number;
  pendingReview: number;
  inProgress: number;
  completed: number;
};

/** 목록·대시보드와 동일: 제품(목록 행) 단위 상태 집계 */
export function summarizeProductionListRowStats(
  rows: ProductionRequestListRow[]
): ProductionDashboardStats {
  let pendingReview = 0;
  let inProgress = 0;
  let completed = 0;

  for (const row of rows) {
    const status = row.lineStatus;
    if (status === 'pending_review') {
      pendingReview++;
    } else if (status === 'confirmed' || status === 'in_progress') {
      inProgress++;
    } else if (status === 'completed') {
      completed++;
    }
  }

  return {
    total: rows.length,
    pendingReview,
    inProgress,
    completed,
  };
}

export function summarizeProductionRequestStats(
  requests: ProductionRequest[]
): ProductionDashboardStats {
  return summarizeProductionListRowStats(expandProductionRequestsToListRows(requests));
}

/** 대시보드 집계용 — expand 목록 행에 필요한 필드만 매핑 */
export function productionRequestForListStatsFromFirestore(
  id: string,
  data: DocumentData
): ProductionRequest {
  const rawOrderQty = data.orderQuantity ?? data.orderqty ?? data.order_qty;
  const parsedOrderQty =
    typeof rawOrderQty === 'number'
      ? rawOrderQty
      : rawOrderQty
        ? Number(rawOrderQty)
        : undefined;

  return {
    id,
    userId: data.userId ?? '',
    userName: data.userName ?? '',
    userEmail: data.userEmail ?? '',
    userCompany: data.userCompany,
    productName: data.productName ?? '',
    productCode: data.productCode || '',
    quantity: data.quantity ?? 0,
    orderQuantity: parsedOrderQty,
    plannedQuantity: data.plannedQuantity,
    requestDate: data.requestDate?.toDate?.() ?? new Date(),
    requestedCompletionDate: data.requestedCompletionDate?.toDate?.() ?? new Date(),
    productionReason: data.productionReason ?? 'inventory',
    salesRegion:
      data.salesRegion === 'overseas' || data.salesRegion === 'domestic'
        ? data.salesRegion
        : undefined,
    products: Array.isArray(data.products) ? (data.products as CertificateProduct[]) : undefined,
    customerName: data.customerName,
    status: data.status || 'pending_review',
    plannedCompletionDate: data.plannedCompletionDate?.toDate?.(),
    memo: data.memo || '',
    createdAt: data.createdAt?.toDate?.() ?? new Date(),
    updatedAt: data.updatedAt?.toDate?.() ?? new Date(),
  };
}

export function getProductionRequestProductRows(
  request: Pick<ProductionRequest, 'productName' | 'productCode' | 'products'>
): { productName: string; productCode: string }[] {
  if (request.products?.length) {
    return request.products.map((p) => ({
      productName: p.productName || '-',
      productCode: p.productCode || '-',
    }));
  }
  return [
    {
      productName: request.productName || '-',
      productCode: request.productCode || '-',
    },
  ];
}

export function formatProductionRequestProductNames(
  request: Pick<ProductionRequest, 'productName' | 'productCode' | 'products'>
): string {
  return getProductionRequestProductRows(request)
    .map((row) => row.productName)
    .join(', ');
}

export function formatProductionRequestProductCodes(
  request: Pick<ProductionRequest, 'productName' | 'productCode' | 'products'>
): string {
  return getProductionRequestProductRows(request)
    .map((row) => row.productCode)
    .join(', ');
}
