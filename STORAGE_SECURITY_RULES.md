# Firebase Storage 보안 규칙

## 현재 문제

`inspection_certi` 하위 폴더에 대한 접근 권한이 없어서 오류가 발생합니다.

## 수정된 규칙

Firebase Console > Storage > 규칙 탭에서 다음 규칙으로 교체하세요:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // certificates 폴더: 성적서 첨부 파일 (하위 폴더 포함)
    match /certificates/{certificateId}/{allPaths=**} {
      // 모든 사용자가 성적서 첨부 파일을 읽을 수 있음
      allow read: if true;
      
      // 인증된 사용자는 성적서 첨부 파일을 업로드할 수 있음
      // 개발 환경에서는 모든 사용자 허용 (request.auth != null 제거)
      allow write: if true;
    }
    
    // inquiries 폴더: 문의 첨부 파일
    match /inquiries/{inquiryId}/{allPaths=**} {
      // 모든 사용자가 문의 첨부 파일을 읽을 수 있음
      allow read: if true;
      
      // 인증된 사용자는 문의 첨부 파일을 업로드할 수 있음
      // 개발 환경에서는 모든 사용자 허용 (request.auth != null 제거)
      allow write: if true;
    }
  }
}
```

## 주요 변경 사항

1. **`{fileName}` → `{allPaths=**}`**: 하위 폴더까지 포함하도록 변경
   - 기존: `match /certificates/{certificateId}/{fileName}` (단일 파일만)
   - 수정: `match /certificates/{certificateId}/{allPaths=**}` (하위 폴더 포함)

2. **`allow write: if request.auth != null` → `allow write: if true`**: 
   - 개발 환경에서는 인증 없이도 업로드 가능하도록 변경
   - 프로덕션에서는 `request.auth != null`로 되돌리는 것을 권장

## 적용 방법

1. Firebase Console 접속: https://console.firebase.google.com
2. 프로젝트 선택
3. 왼쪽 메뉴에서 "Storage" 클릭
4. "규칙" 탭 클릭
5. 위의 수정된 규칙을 복사하여 붙여넣기
6. "게시" 버튼 클릭

## 프로덕션 환경 권장 규칙

프로덕션 환경에서는 보안을 강화하세요:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /certificates/{certificateId}/{allPaths=**} {
      allow read: if true;
      // 인증된 사용자만 업로드 가능
      allow write: if request.auth != null;
    }
    
    match /inquiries/{inquiryId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

