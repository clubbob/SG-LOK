import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth } from '@/lib/firebase';

/**
 * 관리자 하위 페이지에서 Firestore 규칙이 `request.auth != null` 일 때,
 * 레이아웃의 익명 로그인보다 먼저 getDocs 가 나가면 permission-denied 가 납니다.
 * Firestore 호출 직전에 한 번 호출하세요.
 */
export async function ensureFirebaseAuthForAdmin(): Promise<void> {
  if (auth.currentUser) return;

  try {
    await signInAnonymously(auth);
  } catch {
    // 익명 실패 시에도 onAuthStateChanged 로 이미 로그인된 세션을 기다림
  }

  if (auth.currentUser) return;

  await new Promise<void>((resolve, reject) => {
    let unsub = () => {};
    const t = setTimeout(() => {
      unsub();
      reject(new Error('Firebase 인증 대기 시간 초과'));
    }, 15000);

    unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        clearTimeout(t);
        unsub();
        resolve();
      }
    });
  });
}
