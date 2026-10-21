import { Timestamp } from 'firebase/firestore';
import {
  CertificateProduct,
  ProductionReason,
  ProductionRequest,
  ProductionRequestStatus,
  ProductionSalesRegion,
} from '@/types';

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
};

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

/** 확정·진행·완료·취소 이후에는 제품·요청 내용 수정 불가 */
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

/** 다중 제품 문서에서 줄별 상태 (미승인 줄은 대기중) */
export function resolveProductionLineStatus(
  product: CertificateProduct | undefined,
  request: ProductionRequest,
  multiProduct: boolean
): ProductionRequestStatus {
  if (product?.lineStatus) {
    return normalizeProductionRequestStatus(product.lineStatus);
  }
  if (multiProduct && request.status === 'pending_review') {
    return 'pending_review';
  }
  return normalizeProductionRequestStatus(request.status);
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
          lineStatus: resolveProductionLineStatus(product, request, multiProduct),
          plannedQuantity: linePlannedQuantity(product, request, multiProduct),
          plannedCompletionDate: linePlannedCompletionDate(product, request, multiProduct),
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
        lineStatus: normalizeProductionRequestStatus(request.status),
        plannedQuantity: request.plannedQuantity ?? null,
        plannedCompletionDate: request.plannedCompletionDate,
      });
    }
  }
  return rows;
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
