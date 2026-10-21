import type { DocumentData } from 'firebase/firestore';
import { Certificate } from '@/types';

export type CertificateListRowMapOptions = {
  /** 관리자 목록: certificateType·requestDate 없는 문서 제외 */
  skipInvalidShape?: boolean;
  defaultUserId?: string;
  defaultUserName?: string;
};

/**
 * Firestore certificates 문서 → 성적서목록2 목록 행 (관리자 list2 / 사용자 목록 공통)
 */
export function certificateDocToListRow(
  id: string,
  data: DocumentData,
  options?: CertificateListRowMapOptions
): Certificate | null {
  if (data.productionReason) {
    return null;
  }

  if (options?.skipInvalidShape && !data.certificateType && !data.requestDate) {
    return null;
  }

  const mtcProducts =
    data.materialTestCertificate?.products && Array.isArray(data.materialTestCertificate.products)
      ? data.materialTestCertificate.products
      : [];
  const legacyProducts = data.products && Array.isArray(data.products) ? data.products : [];
  const effectiveProducts = mtcProducts.length > 0 ? mtcProducts : legacyProducts;
  const firstProduct = effectiveProducts.length > 0 ? effectiveProducts[0] : null;
  const summarizedProductName =
    effectiveProducts.length <= 1
      ? firstProduct?.productName || data.productName
      : `${firstProduct?.productName || data.productName || '제품'} 외 ${effectiveProducts.length - 1}건`;
  const summarizedProductCode =
    effectiveProducts.length <= 1
      ? firstProduct?.productCode || data.productCode
      : `${firstProduct?.productCode || data.productCode || '-'} 외 ${effectiveProducts.length - 1}건`;
  const summarizedQuantity =
    effectiveProducts.length > 0
      ? effectiveProducts.reduce((sum: number, p: { quantity?: number | string }) => {
          const value =
            typeof p.quantity === 'number'
              ? p.quantity
              : typeof p.quantity === 'string'
                ? Number.parseInt(p.quantity, 10)
                : 0;
          return sum + (Number.isFinite(value) ? value : 0);
        }, 0)
      : firstProduct?.quantity || data.quantity;

  const customerName = data.materialTestCertificate?.customer || data.customerName || '';
  const orderNumber = data.materialTestCertificate?.poNo || data.orderNumber || '';

  return {
    id,
    userId: data.userId ?? options?.defaultUserId ?? '',
    userName: data.userName ?? options?.defaultUserName ?? '',
    userEmail: data.userEmail || '',
    userCompany: data.userCompany || '',
    customerName,
    orderNumber,
    products: effectiveProducts,
    productName: summarizedProductName,
    productCode: summarizedProductCode,
    lotNumber: firstProduct?.lotNumber || data.lotNumber,
    quantity: summarizedQuantity,
    certificateType: data.certificateType || 'quality',
    requestDate: data.requestDate?.toDate() || new Date(),
    requestedCompletionDate: data.requestedCompletionDate?.toDate(),
    status: data.status || 'pending',
    memo: data.memo || '',
    attachments: data.attachments || [],
    certificateFile: data.certificateFile,
    materialTestCertificate: data.materialTestCertificate,
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date(),
    createdBy: data.createdBy,
    updatedBy: data.updatedBy,
    completedAt: data.completedAt?.toDate(),
    completedBy: data.completedBy,
  };
}

/** 성적서목록2 다운로드 가능 여부 (v2 작성 데이터 또는 구버전 업로드 파일) */
export function isCertificateList2Downloadable(certificate: Certificate): boolean {
  return !!certificate.materialTestCertificate || !!certificate.certificateFile?.url;
}
