/**
 * Firestore `certificates.attachments`에는 원래 "요청 시 첨부"만 두는 것이 맞지만,
 * V2 저장 과거 버전에서 제품 Inspection Certificate가 root attachments로 합쳐진 문서가 있습니다.
 * 목록/모달에서는 해당 항목을 제외합니다.
 */
export function isInspectionCertificateRootAttachment(att: {
  name?: string;
  url?: string;
  storagePath?: string;
}): boolean {
  const sp = String(att.storagePath ?? '').toLowerCase();
  if (sp.includes('inspection_certi')) return true;
  const url = String(att.url ?? '').toLowerCase();
  if (url.includes('inspection_certi')) return true;
  const name = String(att.name ?? '').toLowerCase();
  if (name.startsWith('inspection_certi_')) return true;
  return false;
}

export function filterRequestAttachmentsOnly<T extends { name?: string; url?: string; storagePath?: string }>(
  attachments: T[] | undefined | null
): T[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.filter((a) => !isInspectionCertificateRootAttachment(a));
}
