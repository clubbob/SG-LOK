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

# 관리자 계정 정보 (선택사항, 기본값 사용 가능)
NEXT_PUBLIC_ADMIN_ID=sglok
NEXT_PUBLIC_ADMIN_PASSWORD=ssgg3660
NEXT_PUBLIC_ADMIN_EMAIL=admin@sglok.com
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

## 7. Firestore 보안 규칙 설정

**중요**: "Missing or insufficient permissions" 오류가 발생하면 보안 규칙을 설정해야 합니다.

1. Firebase Console > Firestore Database > **"규칙"** 탭 클릭
2. 다음 보안 규칙을 복사하여 붙여넣고 **"게시"** 클릭:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // users 컬렉션: 회원 관리
    match /users/{userId} {
      // 모든 사용자가 회원 정보를 읽을 수 있음 (관리자 페이지 접근을 위해)
      // 프로덕션에서는 더 엄격한 규칙 적용 권장
      allow read: if true;
      
      // 인증된 사용자는 자신의 문서만 쓸 수 있음
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // inquiries 컬렉션: 문의 관리
    match /inquiries/{inquiryId} {
      // 모든 사용자가 문의를 읽을 수 있음 (관리자 페이지 접근을 위해)
      // 프로덕션에서는 더 엄격한 규칙 적용 권장
      allow read: if true;
      
      // 인증된 사용자는 새 문의를 작성할 수 있음
      allow create: if request.auth != null && 
                       request.resource.data.userId == request.auth.uid;
      
      // 모든 사용자가 문의를 업데이트할 수 있음 (관리자 답변을 위해)
      // 프로덕션에서는 관리자 권한 체크 추가 권장
      allow update: if true;
    }
    
    // certificates 컬렉션: 성적서관리
    match /certificates/{certificateId} {
      // 모든 사용자가 성적서를 읽을 수 있음 (관리자 페이지 접근 및 자동완성 등)
      // 프로덕션에서는 더 엄격한 규칙 적용 권장
      allow read: if true;
      
      // 인증된 사용자는 자신의 userId로 성적서를 작성할 수 있음
      // 관리자(userId == 'admin')도 성적서를 작성할 수 있음
      allow create: if (request.auth != null && 
                       request.resource.data.userId == request.auth.uid) ||
                       request.resource.data.userId == 'admin';
      
      // 모든 사용자가 성적서를 업데이트할 수 있음 (관리자 접근을 위해)
      // 프로덕션에서는 관리자 권한 체크 추가 권장
      allow update: if true;
      
      // 모든 사용자가 성적서를 삭제할 수 있음 (관리자 접근을 위해)
      // 프로덕션에서는 관리자 권한 체크 추가 권장
      allow delete: if true;
    }
    
    // productionRequests 컬렉션: 생산요청 관리
    match /productionRequests/{requestId} {
      // 모든 사용자가 생산요청을 읽을 수 있음 (관리자 페이지 접근 및 자동완성 등)
      // 프로덕션에서는 더 엄격한 규칙 적용 권장
      allow read: if true;
      
      // 인증된 사용자는 자신의 userId로 생산요청을 작성할 수 있음
      // 관리자(userId == 'admin')도 생산요청을 작성할 수 있음
      allow create: if (request.auth != null && 
                       request.resource.data.userId == request.auth.uid) ||
                       request.resource.data.userId == 'admin';
      
      // 모든 사용자가 생산요청을 업데이트할 수 있음 (관리자 접근을 위해)
      // 프로덕션에서는 관리자 권한 체크 추가 권장
      allow update: if true;
      
      // 모든 사용자가 생산요청을 삭제할 수 있음 (관리자 접근을 위해)
      // 프로덕션에서는 관리자 권한 체크 추가 권장
      allow delete: if true;
    }
  }
}
```

**개발 환경용 간단한 규칙** (테스트용, 프로덕션에서는 사용하지 마세요):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

자세한 내용은 `FIRESTORE_SECURITY_RULES.md` 파일을 참고하세요.

## 8. Firebase Storage 보안 규칙 설정

**중요**: "storage/unauthorized" 오류가 발생하면 Storage 보안 규칙을 설정해야 합니다.

1. Firebase Console > Storage > **"규칙"** 탭 클릭
2. 다음 보안 규칙을 복사하여 붙여넣고 **"게시"** 클릭:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // certificates 폴더: 성적서 관련 파일
    match /certificates/{certificateId}/{allPaths=**} {
      // 모든 사용자가 읽을 수 있음 (관리자 페이지 접근 및 다운로드)
      // 프로덕션에서는 더 엄격한 규칙 적용 권장
      allow read: if true;
      
      // 모든 사용자가 쓸 수 있음 (관리자 파일 업로드를 위해)
      // 프로덕션에서는 관리자 권한 체크 추가 권장
      allow write: if true;
    }
    
    // 기타 파일들도 허용 (필요에 따라 추가)
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

**개발 환경용 간단한 규칙** (테스트용, 프로덕션에서는 사용하지 마세요):

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

## 9. 개발 서버 재시작

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

