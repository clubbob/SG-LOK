/**
 * 최초 관리자 부트스트랩: Firestore에 isAdmin 이 아직 없어도
 * 지정 이메일로 사용자 로그인한 상태에서 관리자 화면 진입을 허용한다.
 */
const BOOTSTRAP_ADMIN_EMAILS = new Set<string>(['clubbob@naver.com']);

export function isBootstrapAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return BOOTSTRAP_ADMIN_EMAILS.has(email.trim().toLowerCase());
}

/**
 * Firestore users.isAdmin 이 명시적으로 false 이면 부트스트랩도 무시한다.
 * (관리자 화면에서 "관리자 기능 해제" 시 사용자 사이트 관리자 버튼이 사라지도록)
 */
export function hasEffectiveAdminAccess(params: {
  firestoreIsAdmin: boolean | undefined;
  email: string | null | undefined;
}): boolean {
  if (params.firestoreIsAdmin === true) return true;
  if (params.firestoreIsAdmin === false) return false;
  return isBootstrapAdminEmail(params.email);
}
