import { Timestamp } from 'firebase/firestore';
import { CertificateAttachment, CertificateProduct, MaterialTestCertificate } from '@/types';

function toAttachmentForFirestore(
  cert: CertificateAttachment,
  productIndex: number,
  productName: string
): Record<string, unknown> {
  const hasStoragePath = typeof cert.storagePath === 'string' && cert.storagePath.trim().length > 0;
  if (!hasStoragePath) {
    throw new Error(
      `첨부 저장 경로 누락: ${productIndex + 1}번 제품(${productName || '-'})의 "${cert.name || '이름 없음'}" 파일에 storagePath가 없습니다. v2는 Storage 경로가 필수입니다.`
    );
  }

  const uploadedAt =
    cert.uploadedAt instanceof Date && !Number.isNaN(cert.uploadedAt.getTime())
      ? cert.uploadedAt
      : new Date();

  const payload: Record<string, unknown> = {
    name: cert.name || '',
    // URL은 토큰/만료 이슈가 있어 보조값으로만 저장하고, storagePath를 기준으로 재조회한다.
    url: cert.url || '',
    storagePath: cert.storagePath,
    size: typeof cert.size === 'number' ? cert.size : 0,
    type: cert.type || '',
    uploadedAt: Timestamp.fromDate(uploadedAt),
    uploadedBy: cert.uploadedBy || 'admin',
  };

  return payload;
}

export function buildV2MaterialTestCertificateForFirestore(
  mtc: MaterialTestCertificate,
  products: CertificateProduct[]
): Record<string, unknown> {
  const mappedProducts = products.map((p, idx) => {
    const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
    const inspectionCerts =
      productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
        ? productWithCerts.inspectionCertificates
        : (p.inspectionCertificate ? [p.inspectionCertificate] : []);

    const certsForFirestore = inspectionCerts.map((cert) =>
      toAttachmentForFirestore(cert, idx, p.productName || '')
    );

    return {
      productName: p.productName,
      productCode: p.productCode || null,
      quantity: p.quantity || null,
      heatNo: p.heatNo || null,
      material: p.material || null,
      remark: p.remark?.trim() ? p.remark.trim() : null,
      inspectionCertificates: certsForFirestore,
      inspectionCertificate: certsForFirestore[0] || null,
    };
  });

  return {
    certificateNo: mtc.certificateNo,
    dateOfIssue: Timestamp.fromDate(mtc.dateOfIssue),
    customer: mtc.customer,
    poNo: mtc.poNo,
    products: mappedProducts,
    testResult: mtc.testResult,
    createdAt: Timestamp.fromDate(mtc.createdAt),
    updatedAt: Timestamp.fromDate(mtc.updatedAt),
    createdBy: mtc.createdBy,
  };
}
