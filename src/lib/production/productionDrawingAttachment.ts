import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { Timestamp } from 'firebase/firestore';
import { storage } from '@/lib/firebase';
import type { CertificateAttachment, CertificateProduct } from '@/types';
import type { RequestProductLine } from '@/lib/products/requestProductLines';
import { firestoreDateToDate } from '@/lib/production/productionRequestDisplay';

export const PRODUCTION_DRAWING_MAX_BYTES = 15 * 1024 * 1024;

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

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 120);
}

export async function uploadProductionDrawingFile(
  file: File,
  requestId: string,
  productIndex: number,
  uploadedBy: string
): Promise<CertificateAttachment> {
  if (file.size > PRODUCTION_DRAWING_MAX_BYTES) {
    throw new Error(`도면 파일은 ${formatProductionDrawingFileSize(PRODUCTION_DRAWING_MAX_BYTES)} 이하여야 합니다.`);
  }
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).slice(2, 10);
  const safeName = sanitizeFileName(file.name);
  const storagePath = `productionRequests/${requestId}/drawings/${productIndex}_${timestamp}_${randomId}_${safeName}`;
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

export function productionLinesHaveDrawingWork(lines: RequestProductLine[]): boolean {
  return lines.some(
    (line) => Boolean(line.pendingDrawingFile) || Boolean(line.removeDrawing && line.existingDrawing)
  );
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
    if (line.removeDrawing) {
      await deleteProductionDrawingStorage(line.existingDrawing?.storagePath);
      const { drawingAttachment: _removed, ...rest } = result[i];
      result[i] = rest;
      continue;
    }
    if (line.pendingDrawingFile) {
      await deleteProductionDrawingStorage(line.existingDrawing?.storagePath);
      const att = await uploadProductionDrawingFile(
        line.pendingDrawingFile,
        ctx.requestId,
        i,
        ctx.uploadedBy
      );
      result[i] = { ...result[i], drawingAttachment: att };
    } else if (line.existingDrawing) {
      result[i] = { ...result[i], drawingAttachment: line.existingDrawing };
    }
  }

  return result;
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
