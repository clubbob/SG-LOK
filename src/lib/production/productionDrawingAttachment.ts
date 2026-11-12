import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { Timestamp } from 'firebase/firestore';
import { storage } from '@/lib/firebase';
import type { CertificateAttachment, CertificateProduct } from '@/types';
import type { RequestProductLine } from '@/lib/products/requestProductLines';
import { firestoreDateToDate } from '@/lib/production/productionRequestDisplay';

export const PRODUCTION_DRAWING_MAX_BYTES = 15 * 1024 * 1024;
export const PRODUCTION_DRAWING_MAX_COUNT = 2;

export const PRODUCTION_DRAWING_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.gif,.webp,.dwg,.dxf,.step,.stp,.igs,.zip,.rar,application/pdf,image/*';

export function formatProductionDrawingFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseDrawingAttachmentFromFirestore(raw: unknown): CertificateAttachment | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.url !== 'string') return undefined;
  const uploadedAt = firestoreDateToDate(o.uploadedAt) ?? new Date();
  return {
    name: o.name,
    url: o.url,
    storagePath: typeof o.storagePath === 'string' ? o.storagePath : undefined,
    size: typeof o.size === 'number' ? o.size : 0,
    type: typeof o.type === 'string' ? o.type : 'application/octet-stream',
    uploadedAt,
    uploadedBy: typeof o.uploadedBy === 'string' ? o.uploadedBy : '',
  };
}

/** 제품 · Firestore — 최대 2건 (단일 필드 하위 호환) */
export function parseProductDrawingAttachments(
  product: CertificateProduct | undefined
): CertificateAttachment[] {
  if (!product) return [];
  const fromArray = Array.isArray(product.drawingAttachments)
    ? product.drawingAttachments
        .map((item) => parseDrawingAttachmentFromFirestore(item))
        .filter((item): item is CertificateAttachment => Boolean(item))
    : [];
  if (fromArray.length > 0) {
    return fromArray.slice(0, PRODUCTION_DRAWING_MAX_COUNT);
  }
  const single = parseDrawingAttachmentFromFirestore(product.drawingAttachment);
  return single ? [single] : [];
}

function storagePathKey(path: string | undefined): string {
  return path?.trim() || '';
}

export function keptExistingDrawingsOnLine(line: RequestProductLine): CertificateAttachment[] {
  const removed = new Set((line.removedDrawingStoragePaths ?? []).map(storagePathKey));
  return (line.existingDrawings ?? []).filter(
    (att) => !removed.has(storagePathKey(att.storagePath))
  );
}

export function drawingCountOnRequestLine(line: RequestProductLine): number {
  return keptExistingDrawingsOnLine(line).length + (line.pendingDrawingFiles?.length ?? 0);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 120);
}

export async function uploadProductionDrawingFile(
  file: File,
  requestId: string,
  productIndex: number,
  slotIndex: number,
  uploadedBy: string
): Promise<CertificateAttachment> {
  if (file.size > PRODUCTION_DRAWING_MAX_BYTES) {
    throw new Error(`도면 파일은 ${formatProductionDrawingFileSize(PRODUCTION_DRAWING_MAX_BYTES)} 이하여야 합니다.`);
  }
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).slice(2, 10);
  const safeName = sanitizeFileName(file.name);
  const storagePath = `productionRequests/${requestId}/drawings/${productIndex}_${slotIndex}_${timestamp}_${randomId}_${safeName}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  return {
    name: file.name,
    url,
    storagePath,
    size: file.size,
    type: file.type || 'application/octet-stream',
    uploadedAt: new Date(),
    uploadedBy,
  };
}

export async function deleteProductionDrawingStorage(storagePath: string | undefined): Promise<void> {
  if (!storagePath?.trim()) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (err) {
    console.warn('도면 Storage 삭제 실패(무시):', storagePath, err);
  }
}

function applyDrawingsToProduct(
  product: CertificateProduct,
  attachments: CertificateAttachment[]
): CertificateProduct {
  const list = attachments.slice(0, PRODUCTION_DRAWING_MAX_COUNT);
  if (list.length === 0) {
    const { drawingAttachment: _a, drawingAttachments: _b, ...rest } = product;
    return rest;
  }
  return {
    ...product,
    drawingAttachments: list,
    drawingAttachment: list[0],
  };
}

/** 등록·수정 저장 시 도면 처리(업로드·유지·삭제) 필요 */
export function productionLinesHaveDrawingWork(lines: RequestProductLine[]): boolean {
  return lines.some(
    (line) =>
      (line.pendingDrawingFiles?.length ?? 0) > 0 ||
      (line.removedDrawingStoragePaths?.length ?? 0) > 0 ||
      (line.existingDrawings?.length ?? 0) > 0
  );
}

/** 폼 줄 ↔ products 배열 — 도면 메타 병합 (업로드 전) */
export function mergeDrawingFromRequestLines(
  lines: RequestProductLine[],
  products: CertificateProduct[]
): CertificateProduct[] {
  const count = Math.min(lines.length, products.length);
  const result = products.map((p) => ({ ...p }));

  for (let i = 0; i < count; i++) {
    const line = lines[i];
    const hasPending = (line.pendingDrawingFiles?.length ?? 0) > 0;
    if (hasPending) continue;

    const kept = keptExistingDrawingsOnLine(line);
    if (kept.length > 0) {
      result[i] = applyDrawingsToProduct(result[i], kept);
      continue;
    }

    const fromFirestore = parseProductDrawingAttachments(result[i]);
    if (fromFirestore.length > 0) {
      result[i] = applyDrawingsToProduct(result[i], fromFirestore);
    }
  }

  return result;
}

export function normalizeCertificateProductsFromFirestore(raw: unknown): CertificateProduct[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => {
    const p = item as CertificateProduct;
    const attachments = parseProductDrawingAttachments(p);
    if (attachments.length === 0) return { ...p };
    return applyDrawingsToProduct(p, attachments);
  });
}

/** 제품 배열에 도면 업로드·삭제 반영 (lines와 products 인덱스 일치) */
export async function enrichProductsWithDrawingAttachments(
  lines: RequestProductLine[],
  products: CertificateProduct[],
  ctx: { requestId: string; uploadedBy: string }
): Promise<CertificateProduct[]> {
  const result = products.map((p) => ({ ...p }));
  const count = Math.min(lines.length, result.length);

  for (let i = 0; i < count; i++) {
    const line = lines[i];
    const kept = keptExistingDrawingsOnLine(line);
    const pending = line.pendingDrawingFiles ?? [];
    const removedPaths = line.removedDrawingStoragePaths ?? [];

    for (const path of removedPaths) {
      await deleteProductionDrawingStorage(path);
    }

    const uploaded: CertificateAttachment[] = [];
    for (let slot = 0; slot < pending.length; slot++) {
      if (kept.length + uploaded.length >= PRODUCTION_DRAWING_MAX_COUNT) break;
      const file = pending[slot];
      uploaded.push(
        await uploadProductionDrawingFile(file, ctx.requestId, i, kept.length + slot, ctx.uploadedBy)
      );
    }

    const combined = [...kept, ...uploaded].slice(0, PRODUCTION_DRAWING_MAX_COUNT);
    result[i] = applyDrawingsToProduct(result[i], combined);
  }

  return result;
}

export function productsWithSerializedDrawings(
  products: CertificateProduct[]
): CertificateProduct[] {
  return products.map((p) => {
    const list = parseProductDrawingAttachments(p).map((att) => ({
      ...att,
      uploadedAt:
        att.uploadedAt instanceof Date && !Number.isNaN(att.uploadedAt.getTime())
          ? att.uploadedAt
          : new Date(),
    }));
    if (list.length === 0) return p;
    return applyDrawingsToProduct(p, list);
  });
}

export function drawingAttachmentToFirestoreValue(
  att: CertificateAttachment
): Record<string, unknown> {
  const uploadedAt =
    att.uploadedAt instanceof Date && !Number.isNaN(att.uploadedAt.getTime())
      ? Timestamp.fromDate(att.uploadedAt)
      : Timestamp.now();
  return {
    name: att.name,
    url: att.url,
    storagePath: att.storagePath ?? null,
    size: att.size,
    type: att.type,
    uploadedAt,
    uploadedBy: att.uploadedBy,
  };
}
