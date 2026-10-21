import { doc, getDoc } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import { db } from '@/lib/firebase';
import { Certificate } from '@/types';
import { generateV2PdfBlob } from '@/lib/certificate/v2PdfPipeline';

const withTimeout = async <T,>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export type DownloadV2CertificatePdfParams = {
  certificate: Certificate;
  storage: FirebaseStorage;
  pdfTimeoutMs?: number;
};

/**
 * 관리자 성적서목록2와 동일: Firestore 최신 문서 기준 v2 PDF 생성 후 새 탭(또는 다운로드)으로 열기
 */
export async function downloadV2CertificatePdf({
  certificate,
  storage,
  pdfTimeoutMs = 120_000,
}: DownloadV2CertificatePdfParams): Promise<void> {
  const previewWindow = window.open('', '_blank');
  if (previewWindow) {
    try {
      previewWindow.opener = null;
    } catch {
      // no-op
    }
    previewWindow.document.write(
      '<!doctype html><title>PDF 생성 중</title><p style="font-family:sans-serif;padding:16px;">PDF 생성 중입니다...</p>'
    );
    previewWindow.document.close();
  }

  try {
    const latestDocSnap = await getDoc(doc(db, 'certificates', certificate.id));
    const latestCertificate: Certificate = latestDocSnap.exists()
      ? ({
          id: latestDocSnap.id,
          ...(latestDocSnap.data() as Omit<Certificate, 'id'>),
        } as Certificate)
      : certificate;

    if (!latestCertificate.materialTestCertificate) {
      throw new Error('성적서 데이터가 없어 PDF를 생성할 수 없습니다.');
    }

    const pdfBlob = await withTimeout(
      generateV2PdfBlob(latestCertificate, storage),
      pdfTimeoutMs,
      `PDF 생성 타임아웃(${Math.floor(pdfTimeoutMs / 1000)}초): 첨부 파일 읽기 또는 병합이 지연되고 있습니다.`
    );
    const blobUrl = URL.createObjectURL(pdfBlob);
    if (previewWindow) {
      previewWindow.location.href = blobUrl;
    } else {
      const downloadLink = document.createElement('a');
      downloadLink.href = blobUrl;
      downloadLink.target = '_blank';
      downloadLink.rel = 'noopener noreferrer';
      downloadLink.download = `MATERIAL_TEST_CERTIFICATE_${certificate.id}.pdf`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (error) {
    if (previewWindow) {
      previewWindow.close();
    }
    throw error;
  }
}

export function openLegacyCertificateFile(certificate: Certificate): void {
  const url = certificate.certificateFile?.url;
  if (!url) {
    throw new Error('성적서 파일 URL이 없습니다.');
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
