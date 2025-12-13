# Firebase 설정 가이드

## 1. Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com)에 접속
2. "프로젝트 추가" 클릭
3. 프로젝트 이름 입력 (예: sglok)
4. Google Analytics 설정 (선택사항)
5. 프로젝트 생성 완료

## 2. 웹 앱 추가

1. Firebase Console에서 프로젝트 선택
2. 왼쪽 메뉴에서 "프로젝트 설정" (톱니바퀴 아이콘) 클릭
3. "일반" 탭에서 "앱 추가" > "웹" 선택
4. 앱 닉네임 입력 (예: sglok-web)
5. "앱 등록" 클릭

## 3. Firebase 설정 복사

앱 등록 후 나타나는 설정 정보를 복사합니다:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

## 4. .env.local 파일 설정

프로젝트 루트에 있는 `.env.local` 파일을 열고 위에서 복사한 값을 입력합니다:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
```

## 5. Firebase Authentication 설정

1. Firebase Console에서 "Authentication" 메뉴 클릭
2. "시작하기" 클릭
3. "이메일/비밀번호" 제공업체 활성화
4. "저장" 클릭

## 6. Firestore Database 설정

1. Firebase Console에서 "Firestore Database" 메뉴 클릭
2. "데이터베이스 만들기" 클릭
3. 프로덕션 모드 또는 테스트 모드 선택
   - **테스트 모드**: 개발 중에는 테스트 모드 권장 (30일 후 자동 잠금)
   - **프로덕션 모드**: 보안 규칙 설정 필요
4. 위치 선택 (asia-northeast3 - 서울 권장)
5. "사용 설정" 클릭

## 7. 개발 서버 재시작

환경 변수를 변경한 후에는 개발 서버를 재시작해야 합니다:

```bash
# 터미널에서 Ctrl + C로 서버 중지 후
npm run dev
```

## 주의사항

- `.env.local` 파일은 Git에 커밋하지 마세요 (이미 .gitignore에 포함됨)
- 환경 변수는 `NEXT_PUBLIC_` 접두사가 있어야 클라이언트에서 사용 가능합니다
- Firebase 설정을 변경한 후에는 반드시 개발 서버를 재시작해야 합니다

## 문제 해결

### "auth/invalid-api-key" 오류
- `.env.local` 파일이 올바른 위치에 있는지 확인
- 환경 변수 이름이 정확한지 확인 (NEXT_PUBLIC_ 접두사 포함)
- 개발 서버를 재시작했는지 확인

### "Firebase: Error (auth/unauthorized-domain)" 오류
- Firebase Console > Authentication > 설정 > 승인된 도메인에 `localhost` 추가

