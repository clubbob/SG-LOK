/**
 * 코드 목록의 등록자 표시용.
 * Firestore `users`에 문서가 없으면(관리자 익명 세션 등) UID 대신 "관리자"로 표시.
 */
export function resolveSubstituteRegistrantLabel(
  createdBy: string | undefined,
  userNameById: Record<string, string>
): string {
  if (!createdBy) return '';
  if (!Object.prototype.hasOwnProperty.call(userNameById, createdBy)) {
    return '관리자';
  }
  const mapped = userNameById[createdBy];
  if (mapped && mapped !== createdBy) return mapped;
  return '이름 미등록';
}
