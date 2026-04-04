# Firestore 보안 규칙 설정 가이드

## 문제
"Missing or insufficient permissions" 오류가 발생하는 경우, Firestore 보안 규칙이 설정되지 않았거나 잘못 설정된 것입니다.

**자주 빠지는 컬렉션**: 규칙을 컬렉션별로만 열어두면, `match`가 없는 경로는 전부 거부됩니다. 이 프로젝트에서는 특히 **`inventory`**(문서 `microWeldProducts` 등)·**`notices`**가 없으면 대시보드·재고현황·공지 페이지에서 동일 오류가 납니다. 아래 **(참고) 기존(컬렉션별) 권장 규칙** 블록에 두 컬렉션이 포함되어 있는지 확인하세요.

**대체품(mappings 등)**: 읽기/쓰기에 `request.auth != null`이 필요합니다. 일반 회원은 이메일 로그인, 관리자 화면은 **익명 로그인**을 쓰는 경우 Firebase Console에서 **Authentication → 익명** 사용이 켜져 있어야 합니다.

## 해결 방법

### 1. Firebase Console 접속
1. [Firebase Console](https://console.firebase.google.com) 접속
2. 프로젝트 선택
3. 왼쪽 메뉴에서 **"Firestore Database"** 클릭
4. **"규칙"** 탭 클릭

### 2. 보안 규칙 설정

**중요**: 관리자 페이지는 localStorage 기반 인증을 사용합니다. 관리자 계정을 따로 설정할 필요 없이, 아이디와 비밀번호만으로 로그인할 수 있습니다. 

공지사항/관리자 페이지에서 `Missing or insufficient permissions` 또는 Firestore 권한 오류가 계속 발생하면,
먼저 개발 기본(전체 허용) 규칙으로 동작을 확인하세요.

아래 코드를 그대로 복사해서 붙여넣고 **"게시"** 버튼을 클릭합니다.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

## (참고) 기존(컬렉션별) 권장 규칙

동작이 확인되면 보안을 위해 아래처럼 컬렉션별 규칙으로 좁히는 게 좋습니다.

다음 보안 규칙은 기존에 사용하던 예시입니다:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // users 컬렉션: 회원 관리
    // - create: 본인 uid 문서만 (가입)
    // - update/delete: 로그인 사용자 전체 허용 → 관리자 페이지(타인 문서 승인·삭제) 동작.
    //   보안: 이론상 로그인한 다른 회원이 SDK로 타인 문서를 조작할 수 있음. 장기적으로 Custom Claim(admin) 권장.
    match /users/{userId} {
      allow read: if true;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null;
      allow delete: if request.auth != null;
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
    
    // productMappings 컬렉션: 제품명코드 매핑 관리
    match /productMappings/{mappingId} {
      // 모든 사용자가 제품명코드 매핑을 읽을 수 있음 (자동완성 기능을 위해)
      allow read: if true;
      
      // 인증된 사용자는 제품명코드 매핑을 추가할 수 있음
      allow create: if request.auth != null;
      
      // 인증된 사용자는 제품명코드 매핑을 수정할 수 있음
      allow update: if request.auth != null;
      
      // 인증된 사용자는 제품명코드 매핑을 삭제할 수 있음
      allow delete: if request.auth != null;
    }
    
    // productMaterialSizes 컬렉션: 제품 소재/사이즈 정보 관리
    match /productMaterialSizes/{materialSizeId} {
      // 모든 사용자가 제품 소재/사이즈 정보를 읽을 수 있음 (성적서 작성 시 자동완성 기능을 위해)
      allow read: if true;
      
      // 인증된 사용자는 제품 소재/사이즈 정보를 추가할 수 있음
      allow create: if request.auth != null;
      
      // 인증된 사용자는 제품 소재/사이즈 정보를 수정할 수 있음
      allow update: if request.auth != null;
      
      // 인증된 사용자는 제품 소재/사이즈 정보를 삭제할 수 있음
      allow delete: if request.auth != null;
    }
    
    // inventory: UHP 재고 문서 (예: microWeldProducts) — 대시보드·재고현황·관리자 재고
    // 규칙에 없으면 listen/get 시 "Missing or insufficient permissions" 발생
    match /inventory/{docId} {
      allow read: if true;
      allow create, update, delete: if request.auth != null;
    }
    
    // notices: 공지사항
    match /notices/{noticeId} {
      allow read: if true;
      allow create, update, delete: if request.auth != null;
    }
    
    // mappings: Swagelok ↔ S-LOK 대체품 매핑 (로그인 사용자 검색·수정)
    match /mappings/{mappingId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
      allow delete: if request.auth != null;
    }
    
    // swagelok_catalog_parts: Swagelok Tube Fitting 카탈로그(제품코드·제품명). 관리자 화면 시드·Admin import
    match /swagelok_catalog_parts/{partId} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null;
      allow delete: if false;
    }
    
    // mapping_history: 변경 이력 (append 전용 — 수정·삭제 불가)
    match /mapping_history/{historyId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if false;
      allow delete: if false;
    }
    
    // Tube Fitting 코드 분해용 마스터 (읽기: 로그인, 관리자 화면에서 편집)
    match /code_material_master/{id} {
      allow read: if request.auth != null;
      allow create, update, delete: if request.auth != null;
    }
    match /code_family_master/{id} {
      allow read: if request.auth != null;
      allow create, update, delete: if request.auth != null;
    }
    match /code_size_master/{id} {
      allow read: if request.auth != null;
      allow create, update, delete: if request.auth != null;
    }
    match /code_option_master/{id} {
      allow read: if request.auth != null;
      allow create, update, delete: if request.auth != null;
    }
  }
}
```

**참고**: 위 규칙은 개발 환경용입니다. 프로덕션에서는 관리자 권한을 더 엄격하게 체크해야 합니다.

### 대체품찾기(mappings) 전용 규칙 요약

Firebase Console > Firestore > **규칙**에 위 `mappings`, `mapping_history`, `swagelok_catalog_parts`, `code_*_master` 블록을 반드시 포함하세요.

| 컬렉션 | 읽기 | 쓰기 | 비고 |
|--------|------|------|------|
| `mappings` | 로그인(`request.auth != null`) | 동일 | 검색·사용자/관리자 수정 |
| `mapping_history` | 로그인 | **create만** | `update`/`delete` 금지 → append only |
| `swagelok_catalog_parts` | 로그인 | 로그인(create/update), delete 불가 | 관리자 「코드 DB」시드 또는 `npm run import:swagelok-catalog` |
| `code_*_master` | 로그인 | 로그인 | 마스터 데이터; 프로덕션에서는 관리자 전용으로 좁히는 것을 권장 |

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
    
    // productMappings 컬렉션: 제품명코드 매핑 관리
    match /productMappings/{mappingId} {
      // 인증된 사용자는 제품명코드 매핑을 읽을 수 있음
      allow read: if request.auth != null;
      
      // 인증된 사용자는 제품명코드 매핑을 추가할 수 있음
      allow create: if request.auth != null;
      
      // 인증된 사용자는 제품명코드 매핑을 수정할 수 있음
      allow update: if request.auth != null;
      
      // 인증된 사용자는 제품명코드 매핑을 삭제할 수 있음
      allow delete: if request.auth != null;
    }
    
    // productMaterialSizes 컬렉션: 제품 소재/사이즈 정보 관리
    match /productMaterialSizes/{materialSizeId} {
      // 인증된 사용자는 제품 소재/사이즈 정보를 읽을 수 있음
      allow read: if request.auth != null;
      
      // 인증된 사용자는 제품 소재/사이즈 정보를 추가할 수 있음
      allow create: if request.auth != null;
      
      // 인증된 사용자는 제품 소재/사이즈 정보를 수정할 수 있음
      allow update: if request.auth != null;
      
      // 인증된 사용자는 제품 소재/사이즈 정보를 삭제할 수 있음
      allow delete: if request.auth != null;
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

