import { getDownloadURL, ref } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { Certificate, CertificateAttachment, CertificateProduct } from '@/types';
import { generatePDFBlobWithProducts as generateFromCreate } from '@/app/admin/certificate/create/CreatePageClient';

type RichProduct = CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };

const toText = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const normalizeDateValue = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value !== null) {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTimestamp.toDate === 'function') {
      const converted = maybeTimestamp.toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
    if (typeof maybeTimestamp.seconds === 'number') {
      const converted = new Date(maybeTimestamp.seconds * 1000);
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const converted = new Date(value);
    return Number.isNaN(converted.getTime()) ? null : converted;
  }
  return null;
};

const normalizeNameKey = (value: string): string =>
  (value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');

const extractStoragePathFromUrl = (url: string): string => {
  if (!url) return '';
  try {
    const marker = '/o/';
    const idx = url.indexOf(marker);
    if (idx < 0) return '';
    const encoded = url.slice(idx + marker.length).split('?')[0] || '';
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

type PdfComposeResult = {
  blob: Blob;
  failedImageCount: number;
  fileValidationResults: Array<{
    productIndex: number;
    productName: string;
    files: Array<{
      fileName: string;
      included: boolean;
      error?: string;
    }>;
  }>;
};

const generatePDFBlobWithProducts = async (
  formData: {
    certificateNo: string;
    dateOfIssue: string;
    customer: string;
    poNo: string;
    testResult: string;
  },
  products: RichProduct[]
): Promise<PdfComposeResult> => {
  // 웹 환경에서 URL 우선 경로를 강제하면 첨부가 누락될 수 있어
  // 생성 페이지와 동일한 기본 경로(getBlob 중심)를 사용한다.
  return await generateFromCreate(formData, products);
};

export async function generateV2PdfBlob(certificate: Certificate, storage: FirebaseStorage): Promise<Blob> {
  const mtc = certificate.materialTestCertificate;
  if (!mtc) {
    throw new Error('성적서 데이터가 없어 PDF를 생성할 수 없습니다.');
  }

  const normalizedProducts: RichProduct[] = (Array.isArray(mtc.products) ? mtc.products : []).map((product) => {
    const p = product as RichProduct;
    const certs = Array.isArray(p.inspectionCertificates)
      ? p.inspectionCertificates
      : p.inspectionCertificate
        ? [p.inspectionCertificate]
        : [];
    return {
      ...p,
      inspectionCertificate: certs[0],
      inspectionCertificates: certs,
    };
  });

  const rootAttachmentMap = new Map<string, CertificateAttachment>();
  for (const att of Array.isArray(certificate.attachments) ? certificate.attachments : []) {
    const key = normalizeNameKey(toText(att.name));
    if (!key) continue;
    rootAttachmentMap.set(key, {
      name: toText(att.name),
      url: toText(att.url),
      storagePath: toText((att as { storagePath?: unknown }).storagePath) || undefined,
      type: toText(att.type),
      size: typeof att.size === 'number' ? att.size : 0,
      uploadedAt: att.uploadedAt instanceof Date ? att.uploadedAt : new Date(),
      uploadedBy: toText(att.uploadedBy) || 'admin',
    });
  }

  for (const product of normalizedProducts) {
    const certs = Array.isArray(product.inspectionCertificates)
      ? product.inspectionCertificates
      : product.inspectionCertificate
        ? [product.inspectionCertificate]
        : [];
    const recovered: CertificateAttachment[] = [];
    for (const cert of certs) {
      const certNameKey = normalizeNameKey(toText(cert.name));
      const rootMatch = certNameKey ? rootAttachmentMap.get(certNameKey) : undefined;
      let normalizedUrl = toText(cert.url) || toText(rootMatch?.url);
      const normalizedStoragePath =
        toText(cert.storagePath) ||
        toText(rootMatch?.storagePath) ||
        extractStoragePathFromUrl(normalizedUrl);
      if (!normalizedUrl && normalizedStoragePath) {
        try {
          normalizedUrl = await getDownloadURL(ref(storage, normalizedStoragePath));
        } catch {
          // noop
        }
      }
      recovered.push({
        ...cert,
        name: toText(cert.name) || toText(rootMatch?.name) || 'inspection_certi',
        url: normalizedUrl,
        storagePath: normalizedStoragePath || undefined,
        type: toText(cert.type) || toText(rootMatch?.type) || '',
        base64:
          (typeof cert.base64 === 'string' && cert.base64.trim().length > 0
            ? cert.base64
            : (typeof rootMatch?.base64 === 'string' && rootMatch.base64.trim().length > 0
                ? rootMatch.base64
                : undefined)),
        size: typeof cert.size === 'number' ? cert.size : 0,
        uploadedAt: cert.uploadedAt instanceof Date ? cert.uploadedAt : new Date(),
        uploadedBy: toText(cert.uploadedBy) || 'admin',
      });
    }
    product.inspectionCertificates = recovered;
    product.inspectionCertificate = recovered[0];
  }

  const hasAnyProductAttachment = normalizedProducts.some((p) => (p.inspectionCertificates?.length || 0) > 0);
  if (!hasAnyProductAttachment && normalizedProducts.length > 0) {
    const fallbackAttachments: CertificateAttachment[] = (Array.isArray(certificate.attachments) ? certificate.attachments : []).map((att) => ({
      name: toText(att.name),
      url: toText(att.url),
      storagePath: toText((att as { storagePath?: unknown }).storagePath) || undefined,
      type: toText(att.type),
      size: typeof att.size === 'number' ? att.size : 0,
      uploadedAt: att.uploadedAt instanceof Date ? att.uploadedAt : new Date(),
      uploadedBy: toText(att.uploadedBy) || 'admin',
    }));
    const dedupedFallback = fallbackAttachments.filter((cert, index, arr) => {
      const storagePath = toText(cert.storagePath).trim();
      const url = toText(cert.url).trim();
      const key = storagePath ? `sp:${storagePath}` : `url:${url}|name:${toText(cert.name)}`;
      return (
        arr.findIndex((x) => {
          const xStoragePath = toText(x.storagePath).trim();
          const xUrl = toText(x.url).trim();
          const xKey = xStoragePath ? `sp:${xStoragePath}` : `url:${xUrl}|name:${toText(x.name)}`;
          return xKey === key;
        }) === index
      );
    });
    normalizedProducts[0].inspectionCertificates = dedupedFallback;
    normalizedProducts[0].inspectionCertificate = dedupedFallback[0];
  }

  const normalizedDate = normalizeDateValue(mtc.dateOfIssue);
  const dateString = normalizedDate
    ? `${normalizedDate.getFullYear()}-${String(normalizedDate.getMonth() + 1).padStart(2, '0')}-${String(normalizedDate.getDate()).padStart(2, '0')}`
    : '';

  const baseResult = await generatePDFBlobWithProducts(
    {
      certificateNo: toText(mtc.certificateNo),
      dateOfIssue: dateString,
      customer: toText(mtc.customer),
      poNo: toText(mtc.poNo),
      testResult: toText((mtc as { testResult?: unknown }).testResult),
    },
    normalizedProducts
  );
  console.log('[v2 단순 모드] PDF 생성 결과', {
    failedImageCount: baseResult.failedImageCount,
    fileValidationResults: baseResult.fileValidationResults,
  });

  if (baseResult.failedImageCount > 0) {
    const failedMessages = baseResult.fileValidationResults
      .flatMap((group) =>
        group.files
          .filter((file) => !file.included)
          .map((file) => `제품${group.productIndex}:${file.fileName}:${file.error || '알 수 없는 오류'}`)
      )
      .slice(0, 3)
      .join(' | ');
    console.warn(
      `[v2 PDF] Inspection 첨부 병합 일부 실패 (실패=${baseResult.failedImageCount})`,
      failedMessages || '상세 로그 없음'
    );
  }

  return baseResult.blob;
}
