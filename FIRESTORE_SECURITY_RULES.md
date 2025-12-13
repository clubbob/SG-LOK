# Firestore 보안 규칙 설정 가이드

## 문제
"Missing or insufficient permissions" 오류가 발생하는 경우, Firestore 보안 규칙이 설정되지 않았거나 잘못 설정된 것입니다.

## 해결 방법

### 1. Firebase Console 접속
1. [Firebase Console](https://console.firebase.google.com) 접속
2. 프로젝트 선택
3. 왼쪽 메뉴에서 **"Firestore Database"** 클릭
4. **"규칙"** 탭 클릭

### 2. 보안 규칙 설정

**중요**: 관리자 페이지는 localStorage 기반 인증을 사용합니다. 관리자 계정을 따로 설정할 필요 없이, 아이디와 비밀번호만으로 로그인할 수 있습니다. 

다음 보안 규칙을 복사하여 붙여넣고 **"게시"** 버튼을 클릭하세요:

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
  }
}
```

**참고**: 위 규칙은 개발 환경용입니다. 프로덕션에서는 관리자 권한을 더 엄격하게 체크해야 합니다.

### 3. 개발 환경용 간단한 규칙 (테스트용)

개발 중에는 다음 규칙을 사용할 수 있습니다 (주의: 프로덕션에서는 사용하지 마세요):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 인증된 사용자는 모든 문서를 읽고 쓸 수 있음 (개발용)
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 4. 테스트 모드로 전환 (임시 해결책)

만약 아직 프로덕션 모드로 설정하지 않았다면:

1. Firebase Console > Firestore Database
2. **"규칙"** 탭
3. 다음 규칙으로 설정 (30일 후 자동 잠금):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(2025, 12, 31);
    }
  }
}
```

**주의**: 이 규칙은 2025년 12월 31일까지 모든 읽기/쓰기를 허용합니다. 개발용으로만 사용하세요.

## 권장 보안 규칙 (프로덕션)

프로덕션 환경에서는 더 엄격한 규칙을 사용하세요:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // users 컬렉션
    match /users/{userId} {
      // 자신의 문서만 읽고 쓸 수 있음
      allow read: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null && request.resource.data.id == request.auth.uid;
      allow update: if request.auth != null && request.auth.uid == userId;
      allow delete: if false; // 사용자 삭제는 서버에서만 처리
    }
    
    // inquiries 컬렉션
    match /inquiries/{inquiryId} {
      // 자신의 문의만 읽을 수 있음
      allow read: if request.auth != null && 
                     resource.data.userId == request.auth.uid;
      
      // 새 문의 작성 (자신의 userId로만)
      allow create: if request.auth != null && 
                       request.resource.data.userId == request.auth.uid &&
                       request.resource.data.status == 'pending';
      
      // 관리자만 답변 작성 가능 (실제로는 서버 측에서 관리자 권한 체크 필요)
      allow update: if request.auth != null && 
                       request.resource.data.userId == resource.data.userId;
    }
  }
}
```

## 규칙 게시 후 확인

1. 규칙을 게시한 후 브라우저를 새로고침
2. 다시 시도해보세요
3. 여전히 오류가 발생하면 브라우저 콘솔에서 오류 메시지를 확인하세요

## 추가 참고사항

- 보안 규칙 변경은 즉시 적용됩니다
- 규칙 문법 오류가 있으면 게시가 거부됩니다
- 규칙을 테스트하려면 Firebase Console의 "규칙 시뮬레이터"를 사용하세요

