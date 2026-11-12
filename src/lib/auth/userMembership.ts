/** Firestore users 문서 — 회원 목록·대시보드 통계에 포함할지 판단 */

export type FirestoreUserFields = {
  deleted?: boolean;
  approved?: boolean;
  createdAt?: { toDate?: () => Date } | Date | null;
};

/** 삭제 처리된 회원 (통계·목록에서 제외) */
export function isDeletedFirestoreUser(data: FirestoreUserFields): boolean {
  return data.deleted === true;
}

/** 정식 가입 회원: createdAt이 있는 문서만 (목록 orderBy와 동일한 대상) */
export function isRegisteredFirestoreUser(data: FirestoreUserFields): boolean {
  if (isDeletedFirestoreUser(data)) return false;
  return data.createdAt != null;
}

export function createdAtMillisFromFirestore(data: FirestoreUserFields): number {
  const c = data.createdAt;
  if (c == null) return 0;
  if (typeof (c as { toDate?: () => Date }).toDate === 'function') {
    return (c as { toDate: () => Date }).toDate().getTime();
  }
  if (c instanceof Date) return c.getTime();
  return 0;
}

export function computeRegisteredUserStats(docs: { data: () => FirestoreUserFields }[]): {
  total: number;
  pending: number;
  approved: number;
} {
  let total = 0;
  let pending = 0;
  let approved = 0;

  for (const docSnap of docs) {
    const data = docSnap.data();
    if (!isRegisteredFirestoreUser(data)) continue;
    total += 1;
    if (data.approved === false) {
      pending += 1;
    } else {
      approved += 1;
    }
  }

  return { total, pending, approved };
}
