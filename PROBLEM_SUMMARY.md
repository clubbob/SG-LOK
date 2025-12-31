# 성적서 PDF 생성 시 이미지 추가 문제

## 문제 상황
- **목표**: 성적서 작성 페이지에서 저장 시, 각 제품의 Inspection Certificate 이미지 파일을 PDF의 별도 페이지로 추가
- **현재 상태**: 표지 페이지는 정상 생성되지만, 이미지가 PDF에 추가되지 않음

## 기술 스택
- **프레임워크**: Next.js 15.5.7 (React)
- **PDF 생성**: jsPDF
- **스토리지**: Firebase Storage
- **언어**: TypeScript

## 현재 구현 상태

### 1. 이미지 저장 (정상 작동)
- 이미지 파일은 Firebase Storage에 정상적으로 저장됨
- 저장 경로: `certificates/${certificateId}/inspection_certi/${fileName}`
- downloadURL이 Firestore에 저장됨

### 2. PDF 생성 시 이미지 다운로드 (실패)

#### 시도한 방법들:

**방법 1: Firebase Storage `getBlob` 사용**
```typescript
const storageRef = ref(storage, decodedPath);
const blob = await getBlob(storageRef);
```
- **문제**: 타임아웃 발생 (15초, 30초 모두 시도했지만 실패)
- **에러**: `getBlob 타임아웃 (30초)`

**방법 2: `fetch` 사용**
```typescript
const response = await fetch(inspectionCert.url);
const blob = await response.blob();
```
- **문제**: CORS 에러 발생
- **에러**: `TypeError: Failed to fetch`

**방법 3: Image 객체에 URL 직접 로드**
```typescript
const img = new Image();
img.crossOrigin = 'anonymous';
img.src = inspectionCert.url;
```
- **문제**: 이미지 로드 실패
- **에러**: `img.onerror` 발생

**방법 4: Canvas로 변환**
```typescript
const canvas = document.createElement('canvas');
ctx.drawImage(img, 0, 0);
const base64Data = canvas.toDataURL('image/png');
```
- **문제**: Image 로드가 실패해서 Canvas 단계까지 도달하지 못함

## 현재 코드 구조

```typescript
// PDF 생성 함수
const generatePDFBlobWithProducts = async (formData, products) => {
  // 1. 표지 페이지 생성 (정상 작동)
  
  // 2. 각 제품의 Inspection Certificate 이미지 추가 (실패)
  for (let index = 0; index < products.length; index++) {
    const inspectionCert = product.inspectionCertificate;
    
    if (inspectionCert?.url) {
      try {
        // 이미지 다운로드 시도
        // - getBlob 시도 → 타임아웃
        // - fetch 시도 → CORS 에러
        // - Image 객체 로드 → 실패
        
        // 이미지가 로드되면 PDF에 추가
        doc.addPage();
        doc.addImage(base64ImageData, 'PNG', imgX, imgY, imgWidthMM, imgHeightMM);
      } catch (error) {
        // 에러 발생 시 해당 이미지만 건너뛰고 계속 진행
        continue;
      }
    }
  }
}
```

## Firebase Storage URL 형식
```
https://firebasestorage.googleapis.com/v0/b/sglok-3cabd.firebasestorage.app/o/certificates%2FTKbxdMwENBUmItd9l1fR%2Finspection_certi%2Finspection_certi_TKbxdMwENBUmItd9l1fR_1767190041115_sscog6qpeua_2025-12-30_01_abc.png?alt=media&token=04305d95-73b1-4b39-ba97-95648b7d5cab
```

## 요구사항
1. 표지 페이지 생성 (현재 정상 작동)
2. 각 제품의 Inspection Certificate 이미지를 별도 페이지로 추가 (현재 실패)
3. 이미지 다운로드 실패 시에도 PDF 생성은 계속 진행 (현재 구현됨)

## 제약사항
- 클라이언트 사이드에서만 작업 가능 (서버 사이드 API 없음)
- Firestore 문서 크기 제한(1MB) 때문에 base64 데이터를 Firestore에 저장할 수 없음
- 이미지 파일은 PNG 형식

## 질문
1. Firebase Storage의 `getBlob`이 타임아웃되는 이유는 무엇일까요?
2. `fetch`로 downloadURL을 다운로드할 때 CORS 에러가 발생하는 이유는 무엇일까요?
3. 클라이언트 사이드에서 Firebase Storage의 이미지를 PDF에 추가하는 가장 안정적인 방법은 무엇일까요?
4. Firebase Storage의 CORS 설정이 필요한가요? 필요하다면 어떻게 설정하나요?
5. 다른 대안이 있을까요? (예: 이미지를 미리 base64로 변환해서 저장, 서버 사이드 프록시 등)

## 추가 정보
- 이미지 파일 크기: 약 500KB ~ 1MB
- 이미지 형식: PNG
- Firebase Storage 보안 규칙: 읽기/쓰기 모두 허용 (`allow read: if true; allow write: if true;`)

