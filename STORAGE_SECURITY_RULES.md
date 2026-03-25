# Firebase Storage 보안 규칙

## 개발 기본(전체 허용)

공지사항(`notices/...`) 첨부 업로드처럼 Storage 권한 오류가 계속 발생할 때는, 개발 기본 규칙으로 먼저 동작을 확인하는 것을 권장합니다.

Firebase Console → **Storage** → **규칙** 탭에서 아래 코드로 **전체 교체** 후 **게시**하세요.

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

## 주의

- 이 규칙은 개발용(보안 취약)입니다. 프로덕션 전에는 반드시 권한을 다시 좁혀야 합니다.

