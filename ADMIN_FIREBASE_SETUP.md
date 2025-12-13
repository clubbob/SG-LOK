# 관리자 Firebase 계정 설정 가이드

## 문제
관리자 페이지에서 Firestore에 접근하려면 관리자도 Firebase Auth로 로그인해야 합니다.

## 해결 방법

### 1. Firebase Console에서 관리자 계정 생성

1. [Firebase Console](https://console.firebase.google.com) 접속
2. 프로젝트 선택
3. 왼쪽 메뉴에서 **"Authentication"** 클릭
4. **"사용자"** 탭 클릭
5. **"사용자 추가"** 버튼 클릭
6. 다음 정보 입력:
   - **이메일**: `admin@sglok.com` (또는 원하는 관리자 이메일)
   - **비밀번호**: `ssgg3660` (관리자 비밀번호와 동일하게 설정)
7. **"사용자 추가"** 클릭

### 2. .env.local 파일에 관리자 정보 설정 (선택사항)

프로젝트 루트의 `.env.local` 파일에 관리자 정보를 추가할 수 있습니다:

```env
# 관리자 계정 정보 (선택사항, 기본값 사용 가능)
NEXT_PUBLIC_ADMIN_ID=sglok
NEXT_PUBLIC_ADMIN_PASSWORD=ssgg3660
NEXT_PUBLIC_ADMIN_EMAIL=admin@sglok.com
```

**참고**: 환경 변수를 설정하지 않으면 기본값(`sglok`, `ssgg3660`, `admin@sglok.com`)이 사용됩니다.

만약 다른 값을 사용하려면:
1. `.env.local` 파일에 위 환경 변수를 추가하고 원하는 값으로 변경
2. 개발 서버 재시작 (`npm run dev`)

### 3. 테스트

1. 브라우저를 새로고침
2. `/admin/login` 페이지로 이동
3. 아이디: `sglok`, 비밀번호: `ssgg3660` 입력
4. 로그인 후 문의 관리 페이지가 정상적으로 표시되는지 확인

## 참고사항

- 관리자 계정은 Firebase Console에서 수동으로 생성해야 합니다
- 관리자 이메일과 비밀번호는 `.env.local`의 `NEXT_PUBLIC_ADMIN_EMAIL`과 `NEXT_PUBLIC_ADMIN_PASSWORD`(또는 기본값)와 일치해야 합니다
- Firebase Auth 로그인이 실패해도 localStorage 기반 인증은 계속 작동하지만, Firestore 접근은 불가능합니다
- 환경 변수를 변경한 후에는 개발 서버를 재시작해야 합니다

