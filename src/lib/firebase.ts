import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Firebase 설정 검증
const isConfigValid = firebaseConfig.apiKey && 
  firebaseConfig.apiKey !== 'your_api_key_here' &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.storageBucket &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId;

if (!isConfigValid) {
  console.error('Firebase 설정이 필요합니다. .env.local 파일에 Firebase 설정을 추가해주세요.');
  console.error('Firebase Console: https://console.firebase.google.com');
  console.error('현재 설정 상태:', {
    apiKey: firebaseConfig.apiKey ? '설정됨' : '설정되지 않음',
    authDomain: firebaseConfig.authDomain || '설정되지 않음',
    projectId: firebaseConfig.projectId || '설정되지 않음',
  });
}

// Firebase 초기화
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  console.error('Firebase 초기화 오류:', error);
  // 개발 환경에서만 더 자세한 오류 메시지 표시
  if (process.env.NODE_ENV === 'development') {
    console.error('Firebase 설정을 확인해주세요:');
    console.error('- .env.local 파일이 존재하는지 확인');
    console.error('- NEXT_PUBLIC_FIREBASE_* 환경 변수가 올바르게 설정되었는지 확인');
    console.error('- Firebase Console에서 프로젝트 설정 > 일반 > 앱에서 설정 확인');
  }
  throw error;
}

// Auth 및 Firestore 인스턴스 내보내기
export const auth = getAuth(app);

// 세션 지속성 설정 - 브라우저를 닫아도 로그인 상태 유지
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('세션 지속성 설정 오류:', error);
});

export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;

