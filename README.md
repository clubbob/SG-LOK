# SGLok 프로젝트

## 기술 스택

- **프레임워크**: Next.js 15.5.7 (App Router)
- **언어**: TypeScript 5
- **UI 라이브러리**: React 19.1.2
- **스타일링**: Tailwind CSS 4
- **백엔드**: Firebase (Firestore, Authentication, Storage)
- **상태 관리**: Zustand 5.0.8
- **이메일**: Nodemailer 7.0.11
- **배포**: Firebase Hosting (Vercel 호환)

## 시작하기

### 필수 요구사항

- Node.js 18 이상
- npm 또는 yarn

### 설치

```bash
npm install
```

### 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 확인하세요.

### 빌드

```bash
npm run build
```

### 프로덕션 실행

```bash
npm start
```

## 환경 변수 설정

`.env.local` 파일을 생성하고 다음 환경 변수를 설정하세요:

### Firebase 관련
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
```

### 이메일 관련
```
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
ADMIN_EMAIL=
```

### 기타
```
NEXT_PUBLIC_BASE_URL=
ADMIN_PHONE=
SMS_API_KEY=
SMS_API_SECRET=
```

## 프로젝트 구조

```
src/
├── app/                    # Next.js App Router 페이지
├── components/            # React 컴포넌트
├── lib/                  # 유틸리티 및 설정
├── hooks/                # 커스텀 훅
├── stores/               # Zustand 상태 관리
└── types/                # TypeScript 타입 정의
```

## 라이선스

MIT

