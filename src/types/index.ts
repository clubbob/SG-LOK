// 공통 타입 정의

export interface User {
  id: string;
  name: string;
  email: string;
  company?: string;
  position?: string;
  phone?: string;
  address?: string;
  businessNumber?: string;
  website?: string;
  userTypes: string[]; // 구매자/판매자 구분
  currentRole?: string; // 현재 선택된 역할
  approved?: boolean; // 관리자 승인 여부 (기본 true, 신규 가입자는 false)
  approvedAt?: Date;
  approvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  deleted?: boolean;
  deletedAt?: Date;
  deletedBy?: string;
  sessionId?: string; // 현재 활성 세션 ID (한 곳에서만 로그인 허용)
  lastLoginAt?: Date; // 마지막 로그인 시간
}

export interface FirebaseError {
  code: string;
  message: string;
}

export interface Inquiry {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userCompany?: string;
  type?: string; // 문의 유형
  subject: string;
  message: string;
  status: 'pending' | 'read' | 'replied';
  createdAt: Date;
  updatedAt: Date;
  repliedAt?: Date;
  replyMessage?: string;
  attachments?: InquiryAttachment[]; // 첨부 파일
  replyAttachments?: InquiryAttachment[]; // 답변 첨부 파일
}

export interface InquiryAttachment {
  name: string; // 파일명
  url: string; // 다운로드 URL
  size: number; // 파일 크기 (bytes)
  type: string; // MIME 타입
}

// 생산요청 관련 타입
export type ProductionRequestStatus = 'pending_review' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
export type ProductionReason = 'order' | 'inventory'; // 주문 / 재고

export interface ProductionRequest {
  id: string;
  userId: string; // 판매 담당자 ID
  userName: string;
  userEmail: string;
  userCompany?: string;
  
  // 기본 정보
  productName: string; // 제품명 (자유 입력, 임시 정보)
  quantity: number; // 수량
  orderQuantity?: number; // 수주수량 (생산목적이 주문인 경우)
  requestDate: Date; // 생산요청일
  requestedCompletionDate: Date; // 완료요청일
  productionReason: ProductionReason; // 생산이유
  customerName?: string; // 고객사명 (생산이유가 주문인 경우)
  
  // 상태 및 관리
  status: ProductionRequestStatus; // 검토 대기 / 확정 / 진행중 / 완료 / 취소
  productionStatus?: 'production_waiting' | 'production_2nd' | 'production_3rd' | 'production_completed'; // 생산현황: 생산 대기 / 2차 진행중 / 3차 진행중 / 생산 완료
  itemCode?: string; // 품목코드 (확정 시 자동 생성)
  itemName?: string; // 정식 품목명 (확정 시)
  
  // 생산 계획 정보 (라인 등록 후)
  productionLine?: string; // 라인
  plannedStartDate?: Date; // 실제 생산개시예정일
  plannedCompletionDate?: Date; // 생산완료예정일
  
  // 실제 생산 정보
  actualStartDate?: Date; // 실제 생산개시일
  actualCompletionDate?: Date; // 실제 생산완료일
  
  // 우선순위 및 메모
  priority?: number; // 우선순위
  memo?: string; // 메모
  adminMemo?: string; // 관리자 비고
  
  // 이력 관리
  createdAt: Date;
  updatedAt: Date;
  createdBy: string; // 생성자 ID
  updatedBy?: string; // 수정자 ID
  history?: ProductionRequestHistory[]; // 변경 이력
}

export interface ProductionRequestHistory {
  id: string;
  changedAt: Date;
  changedBy: string;
  changedByUserName: string;
  changeType: 'created' | 'updated' | 'confirmed' | 'line_assigned' | 'started' | 'completed' | 'cancelled';
  changes: {
    field: string;
    oldValue?: string | number | Date | boolean | null;
    newValue?: string | number | Date | boolean | null;
  }[];
  memo?: string;
}

// 성적서 관련 타입
export type CertificateStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type CertificateType = 'quality' | 'safety' | 'environmental' | 'other'; // 품질 / 안전 / 환경 / 기타

export interface Certificate {
  id: string;
  userId: string; // 요청자 ID
  userName: string;
  userEmail: string;
  userCompany?: string;
  
  // 기본 정보
  customerName?: string; // 고객명
  orderNumber?: string; // 발주 번호
  
  // 제품 정보 (여러 제품 지원)
  products?: CertificateProduct[]; // 제품 배열
  
  // 기존 단일 제품 필드 (하위 호환성 유지, products가 없을 때 사용)
  productName?: string; // 제품명 (deprecated: products 사용)
  productCode?: string; // 제품코드 (deprecated: products 사용)
  lotNumber?: string; // 로트번호 (deprecated: products 사용)
  quantity?: number; // 수량 (deprecated: products 사용)
  
  certificateType: CertificateType; // 성적서 유형
  requestDate: Date; // 요청일
  requestedCompletionDate?: Date; // 완료요청일
  
  // 상태 및 관리
  status: CertificateStatus; // 대기 / 진행중 / 완료 / 취소
  memo?: string; // 메모
  
  // 첨부 파일
  attachments?: InquiryAttachment[]; // 요청 첨부 파일 (최대 3개)
  
  // 성적서 파일
  certificateFile?: CertificateAttachment; // 성적서 파일 (관리자가 업로드)
  
  // MATERIAL TEST CERTIFICATE 내용
  materialTestCertificate?: MaterialTestCertificate; // 성적서 작성 내용
  
  // 이력 관리
  createdAt: Date;
  updatedAt: Date;
  createdBy: string; // 생성자 ID
  updatedBy?: string; // 수정자 ID
  completedAt?: Date; // 완료일
  completedBy?: string; // 완료자 ID
}

export interface CertificateAttachment {
  name: string; // 파일명
  url: string; // 다운로드 URL
  size: number; // 파일 크기 (bytes)
  type: string; // MIME 타입
  uploadedAt: Date; // 업로드 일시
  uploadedBy: string; // 업로드자 ID
}

// 성적서 제품 정보 (여러 제품 지원)
export interface CertificateProduct {
  productName: string;         // 제품명
  productCode?: string;         // 제품코드
  quantity?: number;            // 수량
  lotNumber?: string;           // 로트번호
  heatNo?: string;              // HEAT NO.
  inspectionCertificate?: CertificateAttachment; // 제품별 Inspection Certi
}

// MATERIAL TEST CERTIFICATE 관련 타입
export interface MaterialTestCertificate {
  // 입력 항목
  certificateNo: string;        // CERTIFICATE NO.
  dateOfIssue: Date;            // DATE OF ISSUE
  customer: string;             // CUSTOMER
  poNo: string;                 // PO NO.
  
  // 제품 정보 (여러 제품 지원)
  products: CertificateProduct[]; // 제품 배열
  
  // 기존 단일 제품 필드 (하위 호환성 유지, 사용 중단 예정)
  description?: string;          // DESCRIPTION (deprecated: products 사용)
  code?: string;                 // CODE (deprecated: products 사용)
  quantity?: number;             // Q'TY (deprecated: products 사용)
  testResult?: string;           // TEST RESULT
  heatNo?: string;              // HEAT NO. (deprecated: products 사용)
  
  // INSPECTION CERTIFICATE 첨부 (하위 호환성 유지, 제품별로는 products[].inspectionCertificate 사용)
  inspectionCertificate?: CertificateAttachment;
  
  // 생성 정보
  createdAt: Date;
  updatedAt: Date;
  createdBy: string; // 생성자 ID (관리자)
}
