# Vercel을 통한 Git 배포 가이드

## 1단계: Git 저장소 초기화 및 커밋

### 1.1 Git 저장소 초기화
```bash
git init
```

### 1.2 모든 파일 추가
```bash
git add .
```

### 1.3 첫 커밋 생성
```bash
git commit -m "Initial commit: SG-LOK project"
```

## 2단계: GitHub에 저장소 생성 및 연결

### 2.1 GitHub에서 새 저장소 생성
1. [GitHub](https://github.com)에 로그인
2. 우측 상단의 "+" 버튼 클릭 → "New repository" 선택
3. 저장소 이름 입력 (예: `sglok`)
4. Public 또는 Private 선택
5. **"Initialize this repository with a README" 체크 해제** (이미 로컬에 파일이 있으므로)
6. "Create repository" 클릭

### 2.2 로컬 저장소를 GitHub에 연결
GitHub에서 제공하는 명령어를 사용하거나 아래 명령어를 실행:

```bash
git remote add origin https://github.com/사용자명/sglok.git
git branch -M main
git push -u origin main
```

## 3단계: Vercel에 프로젝트 배포

### 3.1 Vercel 계정 생성/로그인
1. [Vercel](https://vercel.com) 접속
2. "Sign Up" 또는 "Log In" 클릭
3. GitHub 계정으로 로그인 (권장)

### 3.2 프로젝트 가져오기
1. Vercel 대시보드에서 "Add New..." → "Project" 클릭
2. GitHub 저장소 목록에서 `sglok` 선택
3. "Import" 클릭

### 3.3 프로젝트 설정
1. **Framework Preset**: Next.js (자동 감지됨)
2. **Root Directory**: `./` (기본값)
3. **Build Command**: `npm run build` (기본값)
4. **Output Directory**: `.next` (기본값)
5. **Install Command**: `npm install` (기본값)

### 3.4 환경 변수 설정
Vercel 대시보드에서 "Environment Variables" 섹션에 Firebase 설정 추가:

```
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

**중요**: `.env.local` 파일의 값들을 Vercel 환경 변수에 추가해야 합니다.

### 3.5 배포
1. "Deploy" 버튼 클릭
2. 배포 완료까지 대기 (약 1-2분)
3. 배포 완료 후 제공되는 URL로 접속 확인

## 4단계: 자동 배포 설정

### 4.1 자동 배포 활성화
- 기본적으로 Vercel은 Git 저장소의 `main` 브랜치에 푸시할 때마다 자동 배포됩니다.
- Pull Request 생성 시 프리뷰 배포도 자동으로 생성됩니다.

### 4.2 커스텀 도메인 설정 (선택사항)
1. Vercel 프로젝트 설정 → "Domains" 탭
2. 원하는 도메인 입력
3. DNS 설정 안내에 따라 도메인 설정

## 5단계: 이후 업데이트 방법

### 코드 수정 후 배포
```bash
# 1. 변경사항 커밋
git add .
git commit -m "변경사항 설명"

# 2. GitHub에 푸시
git push origin main

# 3. Vercel이 자동으로 배포 시작
```

## 문제 해결

### 배포 실패 시
1. Vercel 대시보드의 "Deployments" 탭에서 오류 로그 확인
2. 환경 변수가 올바르게 설정되었는지 확인
3. 빌드 로그에서 오류 메시지 확인

### 환경 변수 오류
- `.env.local` 파일의 모든 `NEXT_PUBLIC_*` 변수를 Vercel 환경 변수에 추가
- 변수 이름과 값이 정확한지 확인

### Firebase 오류
- Firebase Console에서 "승인된 도메인"에 Vercel 도메인 추가
- 프로덕션 환경 변수가 올바르게 설정되었는지 확인

## 참고사항

- `.env.local` 파일은 Git에 커밋되지 않습니다 (`.gitignore`에 포함됨)
- Vercel 환경 변수는 프로젝트 설정에서 관리합니다
- 무료 플랜에서도 충분히 사용 가능합니다

