# Firestore 인덱스 설정 가이드

## 문제
Firestore에서 복합 쿼리를 사용할 때 인덱스가 필요합니다.

## 해결 방법

### 방법 1: 자동 인덱스 생성 (권장)

오류 메시지에 포함된 링크를 클릭하면 자동으로 인덱스가 생성됩니다:

```
https://console.firebase.google.com/v1/r/project/sglok-3cabd/firestore/indexes?create_composite=...
```

1. 위 링크를 클릭하거나 브라우저에 복사하여 접속
2. Firebase Console에서 인덱스 생성 페이지가 열림
3. "인덱스 만들기" 또는 "Create Index" 버튼 클릭
4. 인덱스 생성 완료까지 몇 분 소요될 수 있음

### 방법 2: 수동 인덱스 생성

1. [Firebase Console](https://console.firebase.google.com) 접속
2. 프로젝트 선택
3. Firestore Database > 인덱스 탭 클릭
4. "인덱스 만들기" 클릭
5. 다음 정보 입력:
   - 컬렉션 ID: `inquiries`
   - 필드 추가:
     - 필드: `userId`, 정렬: 오름차순
     - 필드: `createdAt`, 정렬: 내림차순
   - 쿼리 범위: 컬렉션
6. "만들기" 클릭

### 방법 3: 코드 수정 (인덱스 없이 사용)

인덱스를 생성하지 않고 코드를 수정할 수도 있습니다:

```typescript
// 기존 코드 (인덱스 필요)
const q = query(
  inquiriesRef,
  where('userId', '==', userProfile.id),
  orderBy('createdAt', 'desc')
);

// 수정된 코드 (인덱스 불필요)
const q = query(
  inquiriesRef,
  where('userId', '==', userProfile.id)
);
// 클라이언트 측에서 정렬
```

## 인덱스 생성 확인

인덱스 생성 후:
1. Firebase Console > Firestore Database > 인덱스 탭에서 인덱스 상태 확인
2. 상태가 "빌드 완료" 또는 "Enabled"가 될 때까지 대기
3. 브라우저를 새로고침하고 다시 시도

## 참고사항

- 인덱스 생성은 보통 1-5분 정도 소요됩니다
- 인덱스가 생성되는 동안 쿼리는 실패할 수 있습니다
- 인덱스는 한 번만 생성하면 계속 사용할 수 있습니다

