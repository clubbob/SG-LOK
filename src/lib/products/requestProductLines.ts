import { Timestamp } from 'firebase/firestore';
import {
  CertificateProduct,
  ProductionProductGroup,
  ProductionReason,
  ProductionRequest,
  ProductionSalesRegion,
} from '@/types';
import { firestoreDateToDate } from '@/lib/production/productionRequestDisplay';

export const PRODUCTION_PRODUCT_GROUP_OPTIONS: ProductionProductGroup[] = [
  'Lok Fitting',
  'Pipe Fitting',
  'Lok Valve',
  'UHP Fitting',
  'UHP Valve',
  'Others',
];

export type RequestProductLine = {
  productionReason: string;
  salesRegion: string;
  customerName: string;
  productGroup: string;
  productName: string;
  productCode: string;
  orderQuantity: string;
  quantity: string;
  requestedCompletionDate: string;
  remark: string;
  productNameCode?: string;
};

export type ValidateRequestProductLinesOptions = {
  requireProductGroup?: boolean;
  /** 생산요청: 제품별 생산목적·국내/해외·(주문 시) 고객사명·수주수량 */
  requireProductionContext?: boolean;
  requireOrderQuantity?: boolean;
  requireRequestedCompletionDate?: boolean;
  /** 수정 모드: 과거 완료요청일 허용 */
  allowPastRequestedCompletionDate?: boolean;
};

export function isProductionProductGroup(value: string): value is ProductionProductGroup {
  return PRODUCTION_PRODUCT_GROUP_OPTIONS.includes(value as ProductionProductGroup);
}

function firestoreValueToDateInput(value: unknown): string {
  const d = firestoreDateToDate(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

export const PRODUCT_CODE_NO_SPACE_MESSAGE = '제품코드 빈칸 없이 입력';

export function productCodeHasWhitespace(value: string): boolean {
  return /\s/.test(value);
}

export const createEmptyRequestProductLine = (): RequestProductLine => ({
  productionReason: '',
  salesRegion: '',
  customerName: '',
  productGroup: '',
  productName: '',
  productCode: '',
  orderQuantity: '',
  quantity: '',
  requestedCompletionDate: '',
  remark: '',
  productNameCode: '',
});

function normalizeProductionReason(value: unknown): string {
  return value === 'order' || value === 'inventory' ? value : '';
}

function normalizeSalesRegion(value: unknown): string {
  return value === 'domestic' || value === 'overseas' ? value : '';
}

export function linesFromFirestoreProducts(
  data: {
    products?: CertificateProduct[];
    productName?: string;
    productCode?: string;
    quantity?: number;
    orderQuantity?: number;
    requestedCompletionDate?: unknown;
    productionReason?: unknown;
    salesRegion?: unknown;
    customerName?: string;
  }
): RequestProductLine[] {
  const rootCompletionDate = firestoreValueToDateInput(data.requestedCompletionDate);
  const rootProductionReason = normalizeProductionReason(data.productionReason);
  const rootSalesRegion = normalizeSalesRegion(data.salesRegion);
  const rootCustomerName = data.customerName || '';
  if (data.products && Array.isArray(data.products) && data.products.length > 0) {
    return data.products.map((p, index) => ({
      productionReason: normalizeProductionReason(p.productionReason) || (index === 0 ? rootProductionReason : ''),
      salesRegion: normalizeSalesRegion(p.salesRegion) || (index === 0 ? rootSalesRegion : ''),
      customerName: p.customerName?.trim() || (index === 0 ? rootCustomerName : ''),
      productGroup: p.productGroup || '',
      productName: p.productName || '',
      productCode: p.productCode || '',
      orderQuantity:
        p.orderQuantity != null
          ? String(p.orderQuantity)
          : index === 0 && data.orderQuantity != null
            ? String(data.orderQuantity)
            : '',
      quantity: p.quantity != null ? String(p.quantity) : '',
      requestedCompletionDate:
        firestoreValueToDateInput(p.requestedCompletionDate) ||
        (index === 0 ? rootCompletionDate : ''),
      remark: p.remark || '',
      productNameCode: p.productNameCode || '',
    }));
  }
  if (data.productName || data.productCode || data.quantity) {
    return [
      {
        productionReason: rootProductionReason,
        salesRegion: rootSalesRegion,
        customerName: rootCustomerName,
        productGroup: '',
        productName: data.productName || '',
        productCode: data.productCode || '',
        orderQuantity: data.orderQuantity != null ? String(data.orderQuantity) : '',
        quantity: data.quantity != null ? String(data.quantity) : '',
        requestedCompletionDate: rootCompletionDate,
        remark: '',
        productNameCode: '',
      },
    ];
  }
  return [createEmptyRequestProductLine()];
}

export function validateRequestProductLines(
  products: RequestProductLine[],
  options?: ValidateRequestProductLinesOptions
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!products || products.length === 0) {
    errors.products = '이 입력란을 작성하세요.';
    return errors;
  }
  let hasError = false;
  products.forEach((product, index) => {
    if (options?.requireProductGroup) {
      if (!product.productGroup?.trim()) {
        errors[`productGroup-${index}`] = '제품군을 선택해주세요.';
        hasError = true;
      } else if (!isProductionProductGroup(product.productGroup)) {
        errors[`productGroup-${index}`] = '제품군을 선택해주세요.';
        hasError = true;
      }
    }
    if (!product.productName?.trim()) {
      errors[`productName-${index}`] = '이 입력란을 작성하세요.';
      hasError = true;
    }
    if (!product.productCode?.trim()) {
      errors[`productCode-${index}`] = '이 입력란을 작성하세요.';
      hasError = true;
    } else if (productCodeHasWhitespace(product.productCode)) {
      errors[`productCode-${index}`] = PRODUCT_CODE_NO_SPACE_MESSAGE;
      hasError = true;
    }
    const lineIsOrder =
      options?.requireProductionContext
        ? product.productionReason === 'order'
        : options?.requireOrderQuantity;

    if (options?.requireProductionContext) {
      if (!product.productionReason) {
        errors[`productionReason-${index}`] = '생산목적을 선택해주세요.';
        hasError = true;
      }
      if (!product.salesRegion) {
        errors[`salesRegion-${index}`] = '국내/해외를 선택해주세요.';
        hasError = true;
      }
      if (product.productionReason === 'order' && !product.customerName?.trim()) {
        errors[`customerName-${index}`] = '고객사명을 입력해주세요.';
        hasError = true;
      }
    }

    if (lineIsOrder) {
      if (!product.orderQuantity?.trim()) {
        errors[`orderQuantity-${index}`] = '이 입력란을 작성하세요.';
        hasError = true;
      } else {
        const orderQty = parseInt(product.orderQuantity, 10);
        if (isNaN(orderQty) || orderQty <= 0) {
          errors[`orderQuantity-${index}`] = '1 이상의 숫자를 입력하세요.';
          hasError = true;
        }
      }
    }
    if (!product.quantity?.trim()) {
      errors[`quantity-${index}`] = '이 입력란을 작성하세요.';
      hasError = true;
    } else {
      const qty = parseInt(product.quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        errors[`quantity-${index}`] = '1 이상의 숫자를 입력하세요.';
        hasError = true;
      }
    }
    if (options?.requireRequestedCompletionDate) {
      if (!product.requestedCompletionDate?.trim()) {
        errors[`requestedCompletionDate-${index}`] = '완료요청일을 선택해주세요.';
        hasError = true;
      } else if (!options.allowPastRequestedCompletionDate) {
        const completionDate = new Date(product.requestedCompletionDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (completionDate < today) {
          errors[`requestedCompletionDate-${index}`] = '완료요청일은 오늘 이후여야 합니다.';
          hasError = true;
        }
      }
    }
  });
  if (hasError && !errors.products) {
    // 개별 필드 오류만 있는 경우
  }
  return errors;
}

export function buildCertificateProductsFromLines(products: RequestProductLine[]): CertificateProduct[] {
  const productsData: CertificateProduct[] = [];
  for (const product of products) {
    if (!product.productName.trim() && !product.productCode.trim() && !product.quantity.trim()) {
      continue;
    }
    const productData: CertificateProduct = {
      productName: product.productName.trim().toUpperCase(),
    };
    const code = product.productCode.trim().toUpperCase();
    if (code) productData.productCode = code;
    if (product.quantity.trim()) {
      productData.quantity = parseInt(product.quantity, 10);
    }
    if (product.orderQuantity.trim()) {
      productData.orderQuantity = parseInt(product.orderQuantity, 10);
    }
    if (isProductionProductGroup(product.productGroup)) {
      productData.productGroup = product.productGroup;
    }
    if (product.productNameCode?.trim()) {
      productData.productNameCode = product.productNameCode.trim().toUpperCase();
    }
    if (product.remark?.trim()) {
      productData.remark = product.remark.trim().toUpperCase();
    }
    if (product.requestedCompletionDate?.trim()) {
      productData.requestedCompletionDate = new Date(product.requestedCompletionDate);
    }
    if (product.productionReason === 'order' || product.productionReason === 'inventory') {
      productData.productionReason = product.productionReason;
    }
    if (product.salesRegion === 'domestic' || product.salesRegion === 'overseas') {
      productData.salesRegion = product.salesRegion;
    }
    if (product.productionReason === 'order' && product.customerName?.trim()) {
      productData.customerName = product.customerName.trim();
    }
    productsData.push(productData);
  }
  return productsData;
}

/** 문서 루트 필드 (목록·검색·기존 스키마 호환: 첫 제품 줄 기준) */
export function summarizeProductionRequestRootFromProducts(productsData: CertificateProduct[]): {
  productionReason: ProductionReason;
  salesRegion: ProductionSalesRegion;
  customerName?: string;
} {
  const first = productsData[0];
  if (!first) {
    return { productionReason: 'inventory', salesRegion: 'domestic' };
  }
  const productionReason =
    first.productionReason === 'order' || first.productionReason === 'inventory'
      ? first.productionReason
      : 'inventory';
  const salesRegion =
    first.salesRegion === 'overseas' || first.salesRegion === 'domestic'
      ? first.salesRegion
      : 'domestic';
  const orderLineWithCustomer = productsData.find(
    (p) => p.productionReason === 'order' && p.customerName?.trim()
  );
  return {
    productionReason,
    salesRegion,
    customerName: orderLineWithCustomer?.customerName?.trim() || undefined,
  };
}

export function requestHasOrderProductionLine(products: RequestProductLine[]): boolean {
  return products.some((p) => p.productionReason === 'order');
}

export function summarizeOrderQuantityFromOrderLines(productsData: CertificateProduct[]): number {
  return productsData.reduce(
    (sum, p) =>
      sum +
      (p.productionReason === 'order' && typeof p.orderQuantity === 'number' ? p.orderQuantity : 0),
    0
  );
}

/** 목록·알림용 단일 필드 (기존 생산요청 스키마 호환) */
export function summarizeProductionLegacyFromProducts(productsData: CertificateProduct[]): {
  productName: string;
  productCode: string;
  quantity: number;
} {
  if (productsData.length === 0) {
    return { productName: '', productCode: '', quantity: 0 };
  }
  const productName = productsData
    .map((p) => p.productName)
    .filter(Boolean)
    .join(', ');
  const productCode = productsData
    .map((p) => p.productCode)
    .filter(Boolean)
    .join(', ');
  const quantity = productsData.reduce((sum, p) => sum + (typeof p.quantity === 'number' ? p.quantity : 0), 0);
  return { productName, productCode, quantity };
}

export function summarizeOrderQuantityFromProducts(productsData: CertificateProduct[]): number {
  return productsData.reduce(
    (sum, p) => sum + (typeof p.orderQuantity === 'number' ? p.orderQuantity : 0),
    0
  );
}

/** 문서 루트 완료요청일 (목록·캘린더 호환: 제품별 일자 중 가장 이른 날) */
export function summarizeRequestedCompletionDateFromProducts(
  productsData: CertificateProduct[]
): Date | null {
  const times = productsData
    .map((p) => firestoreDateToDate(p.requestedCompletionDate as unknown))
    .filter((d): d is Date => d != null && !Number.isNaN(d.getTime()))
    .map((d) => d.getTime());
  if (times.length === 0) return null;
  return new Date(Math.min(...times));
}

/** 제품 줄 삭제 후 Firestore 문서 갱신 필드 */
export function buildProductionRequestPatchAfterProductsChange(
  request: ProductionRequest,
  remainingProducts: CertificateProduct[]
): Record<string, unknown> {
  const summaryProducts: CertificateProduct[] = remainingProducts.map((p) => ({
    ...p,
    requestedCompletionDate: firestoreDateToDate(p.requestedCompletionDate as unknown),
  }));
  const legacy = summarizeProductionLegacyFromProducts(summaryProducts);
  const rootCompletion = summarizeRequestedCompletionDateFromProducts(summaryProducts);
  const rootMeta = summarizeProductionRequestRootFromProducts(summaryProducts);
  const hasOrderLine = summaryProducts.some((p) => p.productionReason === 'order');
  return {
    products: remainingProducts,
    productName: legacy.productName,
    productCode: legacy.productCode,
    quantity: legacy.quantity,
    productionReason: rootMeta.productionReason,
    salesRegion: rootMeta.salesRegion,
    ...(rootMeta.customerName ? { customerName: rootMeta.customerName } : {}),
    orderQuantity: hasOrderLine ? summarizeOrderQuantityFromOrderLines(summaryProducts) : null,
    requestedCompletionDate: rootCompletion ? Timestamp.fromDate(rootCompletion) : null,
    updatedAt: Timestamp.now(),
  };
}
