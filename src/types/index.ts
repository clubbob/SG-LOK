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
  createdAt: Date;
  updatedAt: Date;
  deleted?: boolean;
  deletedAt?: Date;
  deletedBy?: string;
}

export interface FirebaseError {
  code: string;
  message: string;
}
