# Firebase 관리자 계정 오류 해결 가이드

## 오류: `auth/invalid-credential`

이 오류는 Firebase Auth에서 이메일이 존재하지 않거나 비밀번호가 일치하지 않을 때 발생합니다.

## 해결 방법

### 1. .env.local 파일 확인

프로젝트 루트의 `.env.local` 파일을 열고 다음 값들을 확인하세요:

```env
NEXT_PUBLIC_ADMIN_ID=sglok
NEXT_PUBLIC_ADMIN_PASSWORD=ssgg3660
NEXT_PUBLIC_ADMIN_EMAIL=admin@sglok.com
```

**중요**: 위 값들을 기록해두세요. Firebase Console에서 동일한 값으로 계정을 생성해야 합니다.

### 2. Firebase Console에서 관리자 계정 생성/확인

1. [Firebase Console](https://console.firebase.google.com) 접속
2. 프로젝트 선택
3. 왼쪽 메뉴에서 **"Authentication"** 클릭
4. **"사용자"** 탭 클릭
5. 사용자 목록에서 `.env.local`의 `NEXT_PUBLIC_ADMIN_EMAIL` 값과 동일한 이메일이 있는지 확인

#### 계정이 없는 경우:
1. **"사용자 추가"** 버튼 클릭
2. 다음 정보 입력:
   - **이메일**: `.env.local`의 `NEXT_PUBLIC_ADMIN_EMAIL` 값 (예: `admin@sglok.com`)
   - **비밀번호**: `.env.local`의 `NEXT_PUBLIC_ADMIN_PASSWORD` 값 (예: `ssgg3660`)
   - **비밀번호 확인**: 동일한 비밀번호 다시 입력
3. **"사용자 추가"** 클릭

#### 계정이 있는 경우:
1. 계정을 클릭하여 상세 정보 확인
2. **"비밀번호 재설정"** 클릭하여 비밀번호를 `.env.local`의 `NEXT_PUBLIC_ADMIN_PASSWORD` 값으로 변경
   - 또는 `.env.local`의 비밀번호를 Firebase Console의 비밀번호와 일치하도록 변경

### 3. 개발 서버 재시작

`.env.local` 파일을 수정한 경우:

1. 개발 서버 중지 (터미널에서 `Ctrl + C`)
2. 개발 서버 재시작: `npm run dev`

### 4. 다시 로그인 시도

1. 브라우저 새로고침 (F5)
2. `/admin/login` 페이지로 이동
3. 아이디: `.env.local`의 `NEXT_PUBLIC_ADMIN_ID` (또는 기본값 `sglok`)
4. 비밀번호: `.env.local`의 `NEXT_PUBLIC_ADMIN_PASSWORD` (또는 기본값 `ssgg3660`)
5. 로그인 버튼 클릭

## 확인 체크리스트

- [ ] `.env.local` 파일에 `NEXT_PUBLIC_ADMIN_EMAIL`이 설정되어 있음
- [ ] `.env.local` 파일에 `NEXT_PUBLIC_ADMIN_PASSWORD`가 설정되어 있음
- [ ] Firebase Console에 `.env.local`의 `NEXT_PUBLIC_ADMIN_EMAIL`과 동일한 이메일 계정이 존재함
- [ ] Firebase Console의 계정 비밀번호가 `.env.local`의 `NEXT_PUBLIC_ADMIN_PASSWORD`와 일치함
- [ ] 개발 서버를 재시작했음
- [ ] 브라우저를 새로고침했음

## 여전히 오류가 발생하는 경우

1. 브라우저 개발자 도구 (F12) > Console 탭에서 자세한 오류 메시지 확인
2. Firebase Console > Authentication > 사용자에서 계정 상태 확인
3. `.env.local` 파일의 값이 올바른지 다시 한 번 확인
4. 개발 서버를 완전히 종료하고 다시 시작

