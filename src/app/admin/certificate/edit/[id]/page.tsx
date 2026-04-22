"use client";

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getBlob, deleteObject, listAll, getMetadata } from 'firebase/storage';
import { db, storage, auth } from '@/lib/firebase';
import { getProductMappingByCode, getAllProductMappings, addProductMapping, updateProductMapping, deleteProductMapping } from '@/lib/productMappings';
import { CertificateAttachment, MaterialTestCertificate, CertificateProduct, ProductMapping } from '@/types';
import { buildV2MaterialTestCertificateForFirestore } from '@/lib/certificate/v2SaveValidation';
import { signInAnonymously } from 'firebase/auth';

const ADMIN_SESSION_KEY = 'admin_session';

// jsPDF 타입 정의 (필요한 메서드만 포함)
interface JSPDFDocument {
  addImage: (imgData: string, format: string, x: number, y: number, width: number, height: number) => void;
  setFont: (fontName: string, fontStyle?: string) => void;
  setFontSize: (size: number) => void;
  text: (text: string | string[], x: number, y: number, options?: { align?: 'center' | 'left' | 'right' | 'justify' }) => JSPDFDocument;
  getTextWidth: (text: string) => number;
}

type AttachmentKind = 'image' | 'pdf' | 'office' | 'unknown';
type FileRenderStatus = 'rendered_image' | 'merged_pdf' | 'kept_as_attachment' | 'failed';
type FileValidationResult = {
  fileName: string;
  status: FileRenderStatus;
  error?: string;
};
type ProductValidationResult = {
  productIndex: number;
  productName: string;
  files: FileValidationResult[];
};

const getAttachmentKind = (file: CertificateAttachment): AttachmentKind => {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (
    type.startsWith('image/') ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp') ||
    name.endsWith('.gif') ||
    name.endsWith('.bmp')
  ) {
    return 'image';
  }
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    type.includes('word') ||
    type.includes('excel') ||
    name.endsWith('.doc') ||
    name.endsWith('.docx') ||
    name.endsWith('.xls') ||
    name.endsWith('.xlsx')
  ) {
    return 'office';
  }
  return 'unknown';
};

const getAttachmentIdentityKey = (file: CertificateAttachment): string =>
  file.storagePath && file.storagePath.trim().length > 0
    ? `sp:${file.storagePath.trim()}`
    : `nu:${file.name || ''}::${file.url || ''}`;

// 날짜 포맷팅 함수: "2026-01-05" -> "January 5, 2026"
const formatDateLong = (dateStr: string): string => {
  if (!dateStr || dateStr === '-') return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    
    return `${month} ${day}, ${year}`;
  } catch {
    return dateStr;
  }
};

// 한글 텍스트를 Canvas 이미지로 변환하여 PDF에 삽입하는 헬퍼 함수
const renderKoreanText = (
  doc: JSPDFDocument,
  text: string,
  x: number,
  y: number,
  fontSize: number = 12
): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    // 브라우저 환경이 아니면 기본 폰트 사용
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.text(text, x, y);
    return;
  }

  const hasKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text || '');
  if (!hasKorean) {
    // 한글이 없으면 기본 폰트 사용
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.text(text, x, y);
    return;
  }

  try {
    // Canvas를 사용하여 한글 텍스트를 이미지로 변환
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontSize);
      doc.text(text, x, y);
      return;
    }

    // PDF 폰트 크기를 픽셀로 변환 (1pt = 1.333px at 96 DPI)
    const fontSizePx = fontSize * 1.333;
    
    // 폰트 설정
    ctx.font = `300 ${fontSizePx}px "Noto Sans KR Light", "Noto Sans KR", "Malgun Gothic", "맑은 고딕", sans-serif`;
    
    // 텍스트 크기 측정
    const textMetrics = ctx.measureText(text);
    const textWidth = Math.ceil(textMetrics.width) + 4;
    const textHeight = Math.ceil(fontSizePx * 1.1) + 2;
    
    // Canvas 크기 설정 (고해상도)
    const scale = 2;
    canvas.width = textWidth * scale;
    canvas.height = textHeight * scale;
    ctx.scale(scale, scale);
    
    // 배경 투명
    ctx.clearRect(0, 0, textWidth, textHeight);
    
    // 텍스트 렌더링 설정
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // 텍스트 그리기 (두 번 그려서 진하게)
    ctx.fillStyle = '#000000';
    ctx.font = `300 ${fontSizePx}px "Noto Sans KR Light", "Noto Sans KR", "Malgun Gothic", "맑은 고딕", sans-serif`;
    const textX = 2;
    const textY = textHeight - 2;
    ctx.fillText(text, textX, textY);
    ctx.fillText(text, textX + 0.2, textY);
    
    // 이미지 데이터로 변환
    const imgData = canvas.toDataURL('image/png');
    
    // PDF에 이미지 삽입
    const imgWidthMM = textWidth / 3.779527559;
    const imgHeightMM = textHeight / 3.779527559;
    doc.addImage(imgData, 'PNG', x, y - imgHeightMM + 0.5, imgWidthMM, imgHeightMM);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('한글 텍스트 이미지 변환 실패:', errorMessage);
    // 실패 시 기본 폰트 사용
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.text(text, x, y);
  }
};

// PDF를 Blob으로 생성하는 함수 (여러 제품 지원)
const generatePDFBlobWithProducts = async (
  formData: {
    certificateNo: string;
    dateOfIssue: string;
    customer: string;
    poNo: string;
    testResult: string;
  },
  products: CertificateProduct[]
): Promise<{ 
  blob: Blob; 
  failedImageCount: number;
  fileValidationResults: ProductValidationResult[];
}> => {
  // 디버깅: PDF 생성 함수에 전달된 formData 확인
  console.log('[PDF 생성] 함수 호출 시 전달된 formData:', {
    certificateNo: formData.certificateNo,
    dateOfIssue: formData.dateOfIssue,
    customer: formData.customer,
    poNo: formData.poNo,
    testResult: formData.testResult,
  });
  console.log('[PDF 생성] 함수 호출 시 전달된 products 상세 정보:', products.map((p, idx) => {
    const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
    const inspectionCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
      ? productWithCerts.inspectionCertificates
      : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
    return {
      index: idx + 1,
      productName: p.productName,
      productCode: p.productCode,
      quantity: p.quantity,
      heatNo: p.heatNo,
      material: p.material,
      inspectionCertificates: productWithCerts.inspectionCertificates,
      inspectionCertificatesIsArray: Array.isArray(productWithCerts.inspectionCertificates),
      inspectionCertificatesLength: productWithCerts.inspectionCertificates?.length || 0,
      inspectionCertificate: p.inspectionCertificate,
      inspectionCertsLength: inspectionCerts.length,
      inspectionCerts: inspectionCerts.map((c, certIdx) => ({
        index: certIdx + 1,
        name: c.name,
        url: c.url,
        hasBase64: !!c.base64,
        storagePath: c.storagePath,
      })),
    };
  }));
  // 동적 import로 jsPDF 로드
  // ESM 번들(jsPDF.es.min.js)에서 chunk 로딩 실패가 날 수 있어 UMD로 로드
  type JsPDFClass = (typeof import('jspdf'))['jsPDF'];
  const jspdfModule = (await import('jspdf/dist/jspdf.umd.min.js')) as unknown as Partial<{
    jsPDF: JsPDFClass;
    default: JsPDFClass;
  }>;
  const jsPDF = jspdfModule.jsPDF ?? jspdfModule.default;
  if (!jsPDF) {
    throw new Error('jsPDF 로드 실패');
  }
  // A4 가로 방향으로 설정
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // 한글 폰트 추가 (Noto Sans KR)
  // CDN에서 TTF 폰트 로드
  let koreanFontLoaded = false;
  
  // Base64 인코딩 헬퍼 함수 (큰 파일 처리용)
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // 여러 CDN 소스에서 폰트 로드 시도
  const fontUrls = [
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanskr/NotoSansKR-Regular.ttf',
  ];

  for (const fontUrl of fontUrls) {
    try {
      const fontResponse = await fetch(fontUrl);
      if (fontResponse.ok) {
        const fontArrayBuffer = await fontResponse.arrayBuffer();
        
        // 폰트 파일 크기 확인 (너무 크면 건너뛰기)
        if (fontArrayBuffer.byteLength > 10 * 1024 * 1024) {
          console.warn('폰트 파일이 너무 큽니다:', fontArrayBuffer.byteLength);
          continue;
        }
        
        // 빈 파일 체크
        if (fontArrayBuffer.byteLength === 0) {
          console.warn('폰트 파일이 비어있습니다');
          continue;
        }
        
        const fontBase64 = arrayBufferToBase64(fontArrayBuffer);
        
        // Base64 문자열이 유효한지 확인
        if (!fontBase64 || fontBase64.length === 0) {
          console.warn('폰트 Base64 인코딩 실패');
          continue;
        }
        
        try {
          // 폰트를 VFS에 추가
          doc.addFileToVFS('NotoSansKR-Regular.ttf', fontBase64);
          
          // 폰트 등록 (에러 발생 가능성 있음)
          doc.addFont('NotoSansKR-Regular.ttf', 'NotoSansKR', 'normal');
          
          // 폰트가 실제로 작동하는지 테스트
          try {
            // 테스트용 임시 위치에 한글 텍스트 출력 시도
            const testY = -1000; // 화면 밖 위치
            doc.setFont('NotoSansKR', 'normal');
            doc.setFontSize(12);
            doc.text('테스트', 0, testY);
            
            // 에러가 발생하지 않으면 폰트가 제대로 등록된 것으로 간주
            koreanFontLoaded = true;
            console.log('한글 폰트 로드 및 등록 성공:', fontUrl);
            break; // 성공하면 루프 종료
          } catch (testError: unknown) {
            const errorMessage = testError instanceof Error ? testError.message : String(testError);
            console.warn('폰트 테스트 실패:', errorMessage);
            // 테스트 실패 시 다음 URL 시도
            continue;
          }
        } catch (fontError: unknown) {
          const errorMessage = fontError instanceof Error ? fontError.message : String(fontError);
          console.warn('폰트 등록 실패:', errorMessage);
          // 폰트 등록 실패 시에도 계속 진행 (기본 폰트 사용)
          // jsPDF 객체는 그대로 유지
          continue; // 다음 URL 시도
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`폰트 로드 실패 (${fontUrl}):`, errorMessage);
      continue; // 다음 URL 시도
    }
  }

  if (!koreanFontLoaded) {
    console.warn('한글 폰트 로드 실패 - 기본 폰트로 진행합니다');
  }

  // 페이지 설정
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12; // 상단 여백 줄임 (20 → 12)
  let yPosition = margin;

  // 워터마크 추가 함수 (페이지 중앙에 SG-LOK 표시 - 배경처럼 아주 흐리게)
  const addWatermark = () => {
    // 현재 폰트 설정 저장
    const currentFontSize = doc.getFontSize();
    const currentFont = doc.getFont();
    
    // 페이지 중앙 위치
    const centerX = pageWidth / 2;
    const centerY = pageHeight / 2;
    
    // 워터마크 스타일 설정 (크고 굵게, 현재보다 20% 더 흐리게)
    doc.setFontSize(100); // 큰 폰트 크기
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(236, 236, 236); // 더 밝은 회색 (현재보다 20% 더 흐리게)
    
    // 페이지 중앙에 텍스트 그리기 (회전 없음)
    doc.text('SG-LOK', centerX, centerY, { 
      align: 'center'
    });
    
    // 워터마크를 그린 후 본문 텍스트 설정 복원
    doc.setFontSize(currentFontSize); // 원래 폰트 크기로 복원
    doc.setFont(currentFont.fontName, currentFont.fontStyle); // 원래 폰트 스타일로 복원
    doc.setTextColor(0, 0, 0); // 검은색으로 설정
  };

  // 첫 페이지에 워터마크 추가
  addWatermark();

  // 제목: MATERIAL TEST CERTIFICATE (로고와 같은 높이에 배치하기 위해 먼저 yPosition 계산)
  const titleYPosition = margin + 6; // 타이틀 y 위치 (로고와 같은 높이, 여백 줄임)
  
  // 로고 이미지 추가 (타이틀 왼쪽에 배치)
  let logoWidthMM = 0;
  let logoHeightMM = 0;
  try {
    // 로고 이미지 경로 (public 폴더 기준)
    const logoPath = '/samwon-green-logo.png'; // 삼원그린 로고 이미지
    
    // 로고 이미지를 base64로 로드
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    
    // 로고 이미지 로드 (public 폴더의 이미지 사용)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('로고 이미지 로드 타임아웃')), 5000);
      logoImg.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      logoImg.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('로고 이미지 로드 실패'));
      };
      // Next.js public 폴더의 이미지는 절대 경로로 접근
      logoImg.src = logoPath.startsWith('http') ? logoPath : `${window.location.origin}${logoPath}`;
    });

    // Canvas로 base64 변환
    const canvas = document.createElement('canvas');
    canvas.width = logoImg.width;
    canvas.height = logoImg.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(logoImg, 0, 0);
      const logoBase64 = canvas.toDataURL('image/png');
      
      // 로고 크기 설정 (높이 16.8mm로 설정 - 기존 11.2mm의 1.5배)
      logoHeightMM = 11.2 * 1.5; // 16.8mm
      logoWidthMM = (logoImg.width / logoImg.height) * logoHeightMM;
      
      // PDF에 로고 추가 (왼쪽, Green 글씨가 MATERIAL과 같은 높이)
      // 로고를 위로 올려서 Green 부분이 MATERIAL과 정렬되도록 조정
      const logoY = titleYPosition - (logoHeightMM / 2) - 2; // 2mm 위로 올림
      doc.addImage(logoBase64, 'PNG', margin, logoY, logoWidthMM, logoHeightMM);
    }
  } catch (error) {
    console.warn('로고 이미지 로드 실패, 로고 없이 진행:', error);
  }

  // 제목: MATERIAL TEST CERTIFICATE (로고 오른쪽에 배치)
  doc.setFontSize(20 * 1.3); // 26 (기존 20의 1.3배)
  doc.setFont('helvetica', 'bold');
  doc.text('MATERIAL TEST CERTIFICATE', pageWidth / 2, titleYPosition, { align: 'center' });
  yPosition = titleYPosition + 12; // 여유 공간 추가 (10 -> 12)

  // 회사 정보
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Samwongreen Corporation', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 5;
  doc.setFontSize(8);
  doc.text('101, Mayu-ro 20beon-gil, Siheung-si, Gyeonggi-do, Korea (Zip 15115)', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 4;
  doc.text('Tel. +82 31 431 3452 / Fax. +82 31 431 3460 / E-Mail. sglok@sglok.com', pageWidth / 2, yPosition, { align: 'center' });
  
  // 우측 끝에 original document.png 이미지 추가
  try {
    const originalDocPath = '/original document.png';
    const originalDocImg = new Image();
    originalDocImg.crossOrigin = 'anonymous';
    
    // 이미지 로드 (public 폴더의 이미지 사용)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('original document.png 로드 타임아웃')), 10000);
      originalDocImg.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      originalDocImg.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('original document.png 로드 실패'));
      };
      // Next.js public 폴더의 이미지는 절대 경로로 접근
      originalDocImg.src = originalDocPath.startsWith('http') ? originalDocPath : `${window.location.origin}${originalDocPath}`;
    });
    
    // 이미지를 base64로 변환
    const canvas = document.createElement('canvas');
    canvas.width = originalDocImg.width;
    canvas.height = originalDocImg.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(originalDocImg, 0, 0);
      const base64Data = canvas.toDataURL('image/png');
      const base64ImageData = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      
      // 이미지 크기 설정 (높이 10.5mm로 설정 - 기존 15mm의 70%)
      const imageHeightMM = 15 * 0.7; // 10.5mm
      const imageWidthMM = (originalDocImg.width / originalDocImg.height) * imageHeightMM;
      
      // 페이지 우측 끝에 배치 (회사 정보와 같은 높이)
      const imageX = pageWidth - margin - imageWidthMM;
      const imageY = titleYPosition + 5; // 회사 정보 시작 위치
      
      doc.addImage(base64ImageData, 'PNG', imageX, imageY, imageWidthMM, imageHeightMM);
    }
  } catch (error) {
    console.warn('original document.png 이미지 로드 실패, 이미지 없이 진행:', error);
  }
  
  yPosition += 8;

  // 구분선
  doc.setLineWidth(0.5);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;

  // 기본 정보 섹션
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  
  const leftColumn = margin;
  const rightColumn = pageWidth / 2 + 10;
  const lineHeight = 8;
  let leftY = yPosition;
  let rightY = yPosition;

  // 첫 번째 행: CERTIFICATE NO. (왼쪽) | DATE OF ISSUE (오른쪽)
  doc.setFont('helvetica', 'bold');
  doc.text('CERTIFICATE NO.:', leftColumn, leftY);
  doc.setFont('helvetica', 'normal');
  doc.text(formData.certificateNo || '-', leftColumn + 50, leftY);
  
  doc.setFont('helvetica', 'bold');
  doc.text('DATE OF ISSUE:', rightColumn, rightY);
  doc.setFont('helvetica', 'normal');
  doc.text(formatDateLong(formData.dateOfIssue), rightColumn + 40, rightY);
  leftY += lineHeight;
  rightY += lineHeight;

  // 두 번째 행: CUSTOMER (왼쪽) | PO NO. (오른쪽)
  doc.setFont('helvetica', 'bold');
  doc.text('CUSTOMER:', leftColumn, leftY);
  doc.setFont('helvetica', 'normal');
  renderKoreanText(doc, formData.customer || '-', leftColumn + 50, leftY, 12);
  
  doc.setFont('helvetica', 'bold');
  doc.text('PO NO.:', rightColumn, rightY);
  doc.setFont('helvetica', 'normal');
  renderKoreanText(doc, formData.poNo || '-', rightColumn + 40, rightY, 12);
  leftY += lineHeight;
  rightY += lineHeight;

  // 제품 정보 테이블
  yPosition = leftY + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('PRODUCT INFORMATION:', margin, yPosition);
  yPosition += 10;

  // 제품 테이블 헤더 (DESCRIPTION 열 너비 확대, Q'TY 열 너비 축소, HEAT NO. 우측 확대, REMARK 확대)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  const colNo = margin; // 12mm
  const colDescription = margin + 8; // 20mm
  // DESCRIPTION 열 너비 확대 (제품명이 한 줄로 보이도록)
  const colCode = margin + 65; // Code 시작 위치 (DESCRIPTION 열 확대)
  const colQty = margin + 108; // Q'ty 위치 (Q'TY 열 너비 축소, CODE 열 확대)
  const colMaterial = margin + 130; // Material 위치
  // Material, Result, Heat No., Remark 배치 (HEAT NO.와 REMARK 열 너비 동일하게)
  const availableWidth = pageWidth - margin - colMaterial; // 사용 가능한 너비
  const colResult = colMaterial + availableWidth * 0.20; // Material과 Result 사이 (RESULT 열 너비 확보)
  // HEAT NO.와 REMARK 열을 동일한 너비로 설정
  const heatNoAndRemarkStart = colMaterial + availableWidth * 0.40; // HEAT NO. 시작 위치
  const heatNoAndRemarkEnd = pageWidth - margin; // REMARK 끝 위치 (페이지 끝까지)
  const heatNoAndRemarkWidth = (heatNoAndRemarkEnd - heatNoAndRemarkStart) / 2; // 각 열의 너비 (동일)
  const colHeatNo = heatNoAndRemarkStart; // Heat No. 시작 위치
  const colRemark = heatNoAndRemarkStart + heatNoAndRemarkWidth; // REMARK 시작 위치 (HEAT NO.와 동일한 너비)
  
  doc.text('No.', colNo, yPosition);
  doc.text('DESCRIPTION', colDescription, yPosition);
  doc.text('CODE', colCode, yPosition);
  doc.text("Q'TY", colQty, yPosition);
  doc.text('MATERIAL', colMaterial, yPosition);
  doc.text('RESULT', colResult, yPosition);
  doc.text('HEAT NO.', colHeatNo, yPosition);
  doc.text('REMARK', colRemark, yPosition);
  yPosition += 8;
  
  // 구분선
  doc.setLineWidth(0.3);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 8; // 구분선과 데이터 행 사이 간격 증가 (5mm → 8mm)

  // 제품 데이터 행
  doc.setFont('helvetica', 'normal');
  products.forEach((product, index) => {
    if (yPosition > pageHeight - 30) {
      doc.addPage();
      yPosition = margin + 10;
      // 새 페이지에도 워터마크 추가
      addWatermark();
    }
    
    doc.text(`${index + 1}.`, colNo, yPosition);
    const descriptionText = product.productName || '-';
    // DESCRIPTION 열 너비 (제품명이 한 줄로 보이도록 확대)
    const descriptionWidth = colCode - colDescription - 2; // 약 55mm (DESCRIPTION 열 확대)
    
    // 텍스트 분할 (한 글자씩 나뉘는 것을 방지)
    let descriptionLines: string[] = [];
    if (descriptionText && descriptionText.trim().length > 0) {
      // 먼저 splitTextToSize로 분할
      const splitLines = doc.splitTextToSize(descriptionText, descriptionWidth);
      
      // 한 글자씩 나뉜 경우를 병합
      const mergedLines: string[] = [];
      for (let i = 0; i < splitLines.length; i++) {
        const currentLine = splitLines[i].trim();
        
        // 현재 줄이 너무 짧고 (1-2글자) 다음 줄이 있으면 병합 시도
        if (currentLine.length <= 2 && i < splitLines.length - 1) {
          const nextLine = splitLines[i + 1].trim();
          const merged = currentLine + (currentLine && !currentLine.endsWith(' ') ? ' ' : '') + nextLine;
          
          // 병합된 텍스트가 너비를 초과하는지 확인
          const mergedSplit = doc.splitTextToSize(merged, descriptionWidth);
          if (mergedSplit.length === 1) {
            // 병합 가능하면 병합
            mergedLines.push(merged);
            i++; // 다음 줄 건너뛰기
          } else {
            // 병합 불가능하면 현재 줄만 추가
            mergedLines.push(currentLine);
          }
        } else {
          mergedLines.push(currentLine);
        }
      }
      
      descriptionLines = mergedLines.length > 0 ? mergedLines : [descriptionText];
    } else {
      descriptionLines = ['-'];
    }
    
    let descY = yPosition;
    descriptionLines.forEach((line: string) => {
      if (line.trim().length > 0) {
        renderKoreanText(doc, line, colDescription, descY, 10);
        descY += 5;
      }
    });
    // CODE 열 너비 (Code 열 너비 확대)
    const codeWidth = colQty - colCode - 2; // Code 열 너비 확대됨
    const codeLines = doc.splitTextToSize(product.productCode || '-', codeWidth);
    let codeY = yPosition;
    codeLines.forEach((line: string) => {
      renderKoreanText(doc, line, colCode, codeY, 10);
      codeY += 5;
    });
    // Q'TY 열 (간격 확보)
    doc.text((product.quantity || 0).toString(), colQty, yPosition);
    
    // HEAT NO. 열 먼저 처리하여 각 줄의 Y 위치 계산
    const heatNoWidth = colRemark - colHeatNo - 2; // Heat No.와 Remark 사이 너비
    const heatNoText = product.heatNo || '-';
    
    // 쉼표로 구분된 Heat No. 값들 (각각 한 줄씩 표시)
    const heatNoValues = heatNoText.split(',').map(h => h.trim()).filter(h => h.length > 0);
    
    // Heat No.를 각 값별로 줄바꿈하여 표시할 수 있도록 처리
    // 각 Heat No. 값이 몇 줄로 나뉘었는지 추적하여 Material 표시 위치 결정
    const heatNoLines: string[] = [];
    const heatNoValueStartIndices: number[] = []; // 각 Heat No. 값의 첫 번째 줄 인덱스
    
    for (const heatNoValue of heatNoValues) {
      // 각 Heat No. 값이 너무 길면 자동 줄바꿈
      const wrappedLines = doc.splitTextToSize(heatNoValue, heatNoWidth);
      // 첫 번째 줄의 인덱스 저장
      heatNoValueStartIndices.push(heatNoLines.length);
      heatNoLines.push(...wrappedLines);
    }
    
    // Heat No. 값이 없으면 '-' 표시
    if (heatNoLines.length === 0) {
      heatNoLines.push('-');
      heatNoValueStartIndices.push(0);
    }
    
    const heatNoLineCount = heatNoLines.length;
    
    // REMARK 열 처리하여 줄 수 확인
    const remarkWidth = (pageWidth - margin) - colRemark - 2; // Remark 열 너비
    const remarkText = product.remark || '-';
    const remarkLines = doc.splitTextToSize(remarkText, remarkWidth);
    const remarkLineCount = remarkLines.length;
    
    // 최대 줄 수 계산 (Heat No., Remark 중 가장 긴 줄 수)
    Math.max(heatNoLineCount, remarkLineCount);
    
    // MATERIAL 열 (Q'TY 우측에 배치, 각 Heat No. 값의 첫 번째 줄과 같은 높이에 표시)
    const materialText = product.material || '-'; // Material이 없으면 '-' 표시
    // 쉼표로 구분된 Material 값들
    const materialValues = materialText.split(',').map(m => m.trim()).filter(m => m.length > 0);
    
    // RESULT 열 (더 넓은 공간 확보)
    doc.text('GOOD', colResult, yPosition);
    
    // HEAT NO. 열과 MATERIAL 열을 함께 표시 (각 Heat No. 값의 첫 번째 줄에만 Material 표시)
    let heatNoY = yPosition;
    heatNoLines.forEach((line: string, index: number) => {
      // Heat No. 표시
      renderKoreanText(doc, line, colHeatNo, heatNoY, 10);
      
      // 해당 줄이 Heat No. 값의 첫 번째 줄인지 확인
      const isFirstLineOfHeatNoValue = heatNoValueStartIndices.includes(index);
      
      if (isFirstLineOfHeatNoValue) {
        // 첫 번째 줄인 경우에만 Material 표시
        const heatNoValueIndex = heatNoValueStartIndices.indexOf(index);
        if (materialValues.length > 0) {
          // Material 값이 있으면 해당 Heat No. 값 인덱스에 맞는 Material 사용 (없으면 마지막 값 반복)
          const materialValue = materialValues[heatNoValueIndex] || materialValues[materialValues.length - 1];
          doc.text(materialValue, colMaterial, heatNoY);
        } else {
          // Material 값이 없으면 '-' 표시
          doc.text('-', colMaterial, heatNoY);
        }
      }
      // 첫 번째 줄이 아닌 경우 Material을 표시하지 않음 (중복 방지)
      
      heatNoY += 5;
    });
    
    // REMARK 열 표시
    let remarkY = yPosition;
    remarkLines.forEach((line: string) => {
      renderKoreanText(doc, line, colRemark, remarkY, 10);
      remarkY += 5;
    });
    
    yPosition = Math.max(descY, Math.max(codeY, Math.max(heatNoY, Math.max(remarkY, yPosition + 5)))) + 3;
  });

  // 기본 인증 문구 추가 (INSPECTION POINT 위에 배치)
  yPosition += 8;
  // 페이지 넘김 체크
  if (yPosition > pageHeight - 50) {
    doc.addPage();
    yPosition = margin + 10;
    // 새 페이지에도 워터마크 추가
    addWatermark();
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10); // 9pt → 10pt로 한 단계 크게
  const certificationText = 'We hereby certify that all items are strictly compiled with the purchase order, purchase specification, contractual requirement and applicable code & standard, and are supplied with all qualified verification documents hear with.';
  const certificationLines = doc.splitTextToSize(certificationText, pageWidth - (margin * 2));
  certificationLines.forEach((line: string) => {
    doc.text(line, margin, yPosition);
    yPosition += 5;
  });

  // INSPECTION POINT 섹션 추가 (인증 문구 다음)
  yPosition += 8;
  // 페이지 넘김 체크 (INSPECTION POINT가 1페이지에 들어가도록)
  if (yPosition > pageHeight - 50) {
    doc.addPage();
    yPosition = margin + 10;
    // 새 페이지에도 워터마크 추가
    addWatermark();
  }
  
  // INSPECTION POINT 제목
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('INSPECTION POINTS', margin, yPosition);
  yPosition += 8;
  
  // INSPECTION POINT 항목들 (2열로 배치)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  // INSPECTION POINT 출력 포맷
  // - 왼쪽 열: 5개 항목을 bullet로 순서대로 출력
  // - 오른쪽 열: Valve Leak Test (헤더) 아래에 3개 상세 항목을 하위 bullet로 출력
  const leftInspectionPoints = [
    'Raw Material : Dimension, Chemical Composition',
    'Manufactured Products : Dimension, Go/No Gauge',
    'Cleaning : Cleaning Condition',
    'Marking : Code, Others',
    'Packaging : Labeling, Q\'ty',
  ];
  const rightInspectionHeader = 'Valve Leak Test';
  const rightInspectionSubPoints = [
    'Air Test (10kg/cm²) : 100% full test',
    'Hydraulic Test  (320Kg/cm²) : Upon request',
    'N2 Test (70Kg/cm²) : Upon request',
  ];
  
  // 2열로 배치하기 위한 설정
  const columnWidth = (pageWidth - margin * 2 - 20) / 2; // 두 열 너비 (여백과 열 사이 간격 고려)
  const leftColumnX = margin + 5;
  const rightColumnX = leftColumnX + columnWidth + (8 * 0.7); // 열 사이 간격 30% 줄임 (8mm -> 5.6mm)
  const inspectionLineHeight = 6; // 각 항목 간격
  const startY = yPosition; // 시작 Y 위치 저장

  // INSPECTION POINT는 폰트 글리프 지원을 위해 NotoSansKR를 우선 사용(가능한 경우)
  doc.setFont(koreanFontLoaded ? 'NotoSansKR' : 'helvetica', 'normal');
  
  // 사인 컨텐츠를 우측 끝에 배치하기 위한 설정
  const approvalSectionX = pageWidth - margin; // 우측 끝 (margin만큼 여백)
  const signatureHeight = 12; // 사인 이미지 높이 공간
  const approvalStartY = startY; // INSPECTION POINT 시작 Y와 동일
  
  // bullet text를 wrap해서 그리기 + 다음 라인의 시작 y를 계산
  const renderWrappedText = (text: string, x: number, y: number, width: number): number => {
    const wrappedLines = doc.splitTextToSize(text, width);
    wrappedLines.forEach((line: string, i: number) => {
      doc.text(line, x, y + (i * inspectionLineHeight));
    });
    return wrappedLines.length;
  };

  let inspectionLeftY = startY;
  let inspectionRightY = startY;

  // 왼쪽 열: 5개 bullet
  leftInspectionPoints.forEach((point) => {
    const usedLines = renderWrappedText(`- ${point}`, leftColumnX, inspectionLeftY, columnWidth);
    inspectionLeftY += usedLines * inspectionLineHeight;
  });

  // 오른쪽 열: 헤더 + 하위 3개
  const headerUsedLines = renderWrappedText(`- ${rightInspectionHeader}`, rightColumnX, inspectionRightY, columnWidth);
  inspectionRightY += headerUsedLines * inspectionLineHeight;
  rightInspectionSubPoints.forEach((point) => {
    // 원래처럼 모든 항목을 동일한 방식으로 렌더링
    const usedLines = renderWrappedText(`  . ${point}`, rightColumnX, inspectionRightY, columnWidth);
    inspectionRightY += usedLines * inspectionLineHeight;
  });
  
  // 사인 컨텐츠를 INSPECTION POINT 2열 우측 끝에 배치
  // Approved by (첫 번째 줄)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Approved by', approvalSectionX, approvalStartY, { align: 'right' });
  
  // Quality Representative (두 번째 줄)
  const qualityRepY = approvalStartY + 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Quality Representative', approvalSectionX, qualityRepY, { align: 'right' });
  
  // "Quality Representative" 텍스트의 시작 위치 계산 (Q 자 시작 위치)
  const qualityRepText = 'Quality Representative';
  const qualityRepTextWidth = doc.getTextWidth(qualityRepText);
  const qualityRepStartX = approvalSectionX - qualityRepTextWidth;
  
  // 사인 이미지 추가
  const signatureY = qualityRepY + 5; // 위 마진 줄임 (8mm -> 5mm)
  try {
    // 사인 이미지 경로 (public 폴더 기준)
    const signaturePath = '/quality-sign.png';
    
    // 사인 이미지를 base64로 로드
    const signatureImg = new Image();
    signatureImg.crossOrigin = 'anonymous';
    
    // 사인 이미지 로드 (public 폴더의 이미지 사용)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('사인 이미지 로드 타임아웃')), 5000);
      signatureImg.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      signatureImg.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('사인 이미지 로드 실패'));
      };
      // Next.js public 폴더의 이미지는 절대 경로로 접근
      signatureImg.src = signaturePath.startsWith('http') ? signaturePath : `${window.location.origin}${signaturePath}`;
    });

    // Canvas로 base64 변환
    const canvas = document.createElement('canvas');
    canvas.width = signatureImg.width;
    canvas.height = signatureImg.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(signatureImg, 0, 0);
      const signatureBase64 = canvas.toDataURL('image/png');
      
      // 사인 크기 설정 (높이 기준으로 비율 유지)
      const signatureWidthMM = (signatureImg.width / signatureImg.height) * signatureHeight;
      
      // PDF에 사인 추가 (우측 정렬)
      const signatureX = approvalSectionX - signatureWidthMM; // 우측 정렬
      doc.addImage(signatureBase64, 'PNG', signatureX, signatureY, signatureWidthMM, signatureHeight);
    }
  } catch (error) {
    console.warn('사인 이미지 로드 실패, 사인 없이 진행:', error);
  }
  
  // 구분선 (Quality Representative의 Q 자 시작 위치와 통일)
  const lineY = signatureY + signatureHeight + 3; // 아래 마진 줄임 (5mm -> 3mm)
  doc.setLineWidth(0.3);
  doc.line(qualityRepStartX, lineY, approvalSectionX, lineY);
  
  // Date: 성적서 발행일자
  const dateY = lineY + 6; // 마진 줄임 (8mm -> 6mm)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Date: ${formatDateLong(formData.dateOfIssue)}`, approvalSectionX, dateY, { align: 'right' });
  
  // yPosition을 두 열 중 더 아래쪽으로 설정 (3개 항목이므로)
  const inspectionBottomY = Math.max(inspectionLeftY, inspectionRightY);
  yPosition = Math.max(inspectionBottomY + 3, dateY + 8);

  // 표지 다음 페이지부터 각 제품의 INSPECTION CERTIFICATE 이미지를 순서대로 삽입
  console.log('[PDF 생성] Inspection Certificate 이미지 추가 시작, 제품 개수:', products.length);
  console.log('[PDF 생성] 전달된 products 상세 정보:', products.map((p, idx) => {
    const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
    const inspectionCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
      ? productWithCerts.inspectionCertificates
      : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
    return {
      productIndex: idx + 1,
      productName: p.productName,
      inspectionCertificates: productWithCerts.inspectionCertificates,
      inspectionCertificatesIsArray: Array.isArray(productWithCerts.inspectionCertificates),
      inspectionCertificatesLength: productWithCerts.inspectionCertificates?.length || 0,
      inspectionCertificate: p.inspectionCertificate,
      inspectionCertsLength: inspectionCerts.length,
      inspectionCerts: inspectionCerts.map((c, certIdx) => ({
        index: certIdx + 1,
        name: c.name,
        url: c.url,
        hasBase64: !!c.base64,
        storagePath: c.storagePath,
      })),
    };
  }));
  
  let failedImageCount = 0; // 실패한 이미지 개수 추적
  // 각 제품별, 파일별 검증 결과 저장
  const fileValidationResults: ProductValidationResult[] = [];
  
  for (let index = 0; index < products.length; index++) {
    const product = products[index];
    // 여러 파일 지원: inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
    const productWithCerts = product as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
    let inspectionCerts: CertificateAttachment[] = [];
    
    // 제품별 검증 결과 초기화
    const productValidationResult: ProductValidationResult = {
      productIndex: index + 1,
      productName: product.productName || `제품 ${index + 1}`,
      files: [],
    };
    
    // inspectionCertificates 배열이 있으면 사용
    if (productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)) {
      inspectionCerts = productWithCerts.inspectionCertificates;
      console.log(`[PDF 생성] 제품 ${index + 1} "${product.productName}" inspectionCertificates 배열 발견:`, inspectionCerts.length, '개');
    } 
    // inspectionCertificates 배열이 없으면 inspectionCertificate 단일 객체를 배열로 변환
    else if (product.inspectionCertificate) {
      inspectionCerts = [product.inspectionCertificate];
      console.log(`[PDF 생성] 제품 ${index + 1} "${product.productName}" inspectionCertificate 단일 객체 발견`);
    } else {
      console.log(`[PDF 생성] 제품 ${index + 1} "${product.productName}" Inspection Certificate 없음`);
    }
    
    // inspectionCerts 배열에서 유효한 파일만 필터링
    // (url / storagePath 뿐 아니라 미리보기에서 변환된 base64만 있는 경우도 포함)
    const beforeFilterCount = inspectionCerts.length;
    const filteredOutFiles: CertificateAttachment[] = [];
    inspectionCerts = inspectionCerts.filter(cert => {
      const hasUrl = !!(cert && cert.url && cert.url.trim().length > 0);
      const hasStoragePath = !!(cert && cert.storagePath && cert.storagePath.trim().length > 0);
      const hasBase64 = !!(cert && cert.base64 && cert.base64.trim().length > 0);

      // URL/StoragePath/Base64 중 하나라도 있으면 포함
      if (cert && (hasUrl || hasStoragePath || hasBase64)) {
        return true;
      } else {
        filteredOutFiles.push(cert);
        return false;
      }
    });
    
    // URL/StoragePath/base64 모두 없는 파일들을 검증 결과에 추가
    filteredOutFiles.forEach(cert => {
      productValidationResult.files.push({
        fileName: cert.name || '이름 없음',
        status: 'failed',
        error: 'URL, storagePath, base64가 모두 없습니다.',
      });
    });
    
    if (beforeFilterCount !== inspectionCerts.length) {
      console.warn(`[PDF 생성] 제품 ${index + 1} 필터링: ${beforeFilterCount}개 → ${inspectionCerts.length}개 (URL과 storagePath 모두 없는 파일 ${filteredOutFiles.length}개 제거됨)`);
    }
    
    console.log(`[PDF 생성] 제품 ${index + 1} "${product.productName}" 처리 중:`, {
      inspectionCertCount: inspectionCerts.length,
      certs: inspectionCerts.map((c: CertificateAttachment, idx: number) => ({ 
        index: idx + 1,
        name: c.name, 
        url: c.url,
        hasBase64: !!c.base64,
        base64Length: c.base64 ? c.base64.length : 0,
        storagePath: c.storagePath,
        hasUrl: !!c.url && c.url.trim().length > 0,
      })),
    });
    
    if (inspectionCerts.length === 0) {
      console.warn(`[PDF 생성] ⚠️ 제품 ${index + 1} "${product.productName}"에 Inspection Certificate 파일이 없습니다!`);
    } else {
      console.log(`[PDF 생성] 제품 ${index + 1} "${product.productName}" 총 ${inspectionCerts.length}개 파일 처리 시작`);
      console.log(`[PDF 생성] 제품 ${index + 1} 파일 목록:`, inspectionCerts.map((c, idx) => `${idx + 1}. ${c.name} (URL: ${c.url ? '있음' : '없음'})`).join(', '));
    }
    
    // 각 Inspection Certificate 파일을 순회하며 추가
    let successfullyAddedCount = 0; // 제품별로 성공적으로 추가된 파일 개수 추적
    for (let certIndex = 0; certIndex < inspectionCerts.length; certIndex++) {
      const inspectionCert = inspectionCerts[certIndex];
      
      console.log(`[PDF 생성] 제품 ${index + 1} "${product.productName}" 파일 ${certIndex + 1}/${inspectionCerts.length} "${inspectionCert?.name}" 처리 시작:`, {
        name: inspectionCert?.name,
        url: inspectionCert?.url,
        hasBase64: !!inspectionCert?.base64,
        base64Length: inspectionCert?.base64 ? inspectionCert.base64.length : 0,
        storagePath: inspectionCert?.storagePath,
        hasUrl: !!inspectionCert?.url && inspectionCert.url.trim().length > 0,
      });
      
      if (!inspectionCert) {
        console.warn(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1}이 null/undefined입니다. 건너뜀.`);
        continue;
      }
      
      // URL이 스테일/빈 값이어도 storagePath가 있으면 getDownloadURL로 한 번 갱신 시도
      let finalUrl = inspectionCert.url || '';

      const hasBase64 = !!(inspectionCert.base64 && inspectionCert.base64.trim().length > 0);
      const hasStoragePath = !!(inspectionCert.storagePath && inspectionCert.storagePath.trim().length > 0);

      if (hasStoragePath) {
        try {
          console.log(
            `[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} storagePath로 URL 갱신 시도:`,
            inspectionCert.storagePath
          );
          const storageRef = ref(storage, inspectionCert.storagePath!);
          const updated = await getDownloadURL(storageRef);
          finalUrl = updated;
          inspectionCert.url = updated;
          console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} URL 갱신 성공`);
        } catch (urlError) {
          const code =
            typeof urlError === 'object' && urlError !== null && 'code' in urlError
              ? String((urlError as { code?: unknown }).code)
              : undefined;
          if (code === 'storage/object-not-found') {
            console.warn(
              `[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} storagePath 객체가 없어 URL 갱신 불가`
            );
          } else {
            console.warn(
              `[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} URL 갱신 실패:`,
              urlError instanceof Error ? urlError.message : String(urlError)
            );
          }
          // 갱신 실패해도 기존 finalUrl(base64가 있으면) 또는 storagePath 기반 다운로드에서 계속 진행
        }
      }

      // URL/StoragePath/Base64가 전부 없다면 건너뜀
      if ((!finalUrl || finalUrl.trim().length === 0) && !hasStoragePath && !hasBase64) {
        console.warn(
          `[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1}의 URL, storagePath, base64가 모두 없습니다. 건너뜀.`
        );
        failedImageCount++;

        productValidationResult.files.push({
          fileName: inspectionCert.name || '이름 없음',
          status: 'failed',
          error: 'URL, storagePath, base64가 모두 없습니다.',
        });

        continue;
      }
      
      // URL이 있거나 storagePath가 있거나 base64가 있으면 이미지 처리 시도
      if (
        (finalUrl && finalUrl.trim().length > 0) ||
        (inspectionCert.storagePath && inspectionCert.storagePath.trim().length > 0) ||
        (inspectionCert.base64 && inspectionCert.base64.trim().length > 0)
      ) {
      try {
        const attachmentKind = getAttachmentKind(inspectionCert);
        if (attachmentKind !== 'image') {
          console.log(
            `[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} "${inspectionCert.name}"는 이미지 렌더링 대상 아님(${attachmentKind})`
          );
          productValidationResult.files.push({
            fileName: inspectionCert.name || '이름 없음',
            status: 'kept_as_attachment',
            error:
              attachmentKind === 'pdf'
                ? 'PDF 첨부는 후처리 병합 단계에서 반영됩니다.'
                : 'Office/기타 첨부는 원본 파일로 별도 유지됩니다.',
          });
          continue;
        }
        
        console.log(`[PDF 생성] 제품 ${index + 1} 이미지 처리 시작:`, {
          attachmentKind,
          fileType: inspectionCert.type,
          fileName: inspectionCert.name,
          url: inspectionCert.url,
        });
        
        // PNG 이미지 다운로드 및 base64 변환
        let base64ImageData: string = '';
        const imageFormat = 'PNG' as const;
        let img: HTMLImageElement | null = null;
        
        if (inspectionCert.base64) {
          // base64 데이터가 있으면 직접 사용 (우선순위 1)
          console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 데이터 사용 시도, 길이:`, inspectionCert.base64.length);
          try {
            // base64 데이터 정규화
            let normalizedBase64 = inspectionCert.base64;
            if (!normalizedBase64.includes(',')) {
              // data URL prefix가 없으면 추가
              normalizedBase64 = `data:image/png;base64,${normalizedBase64}`;
            }
            
            // base64 데이터에서 실제 base64 부분만 추출
            base64ImageData = normalizedBase64.includes(',') 
              ? normalizedBase64.split(',')[1] 
              : inspectionCert.base64;
            
            // 이미지 로드 검증 (타임아웃 증가: 60초)
            const base64Img = new Image();
            base64Img.src = normalizedBase64;
            await new Promise<void>((resolve) => {
              const timeout = setTimeout(() => {
                console.warn(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 이미지 로드 타임아웃, base64 데이터는 그대로 사용`);
                // 타임아웃이어도 base64 데이터는 있으므로 계속 진행
                resolve();
              }, 60000); // 60초로 증가
              
              base64Img.onload = () => {
                clearTimeout(timeout);
                console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 이미지 로드 완료:`, base64Img.width, 'x', base64Img.height);
                img = base64Img;
                resolve();
              };
              
              base64Img.onerror = () => {
                clearTimeout(timeout);
                console.warn(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 이미지 로드 실패, base64 데이터는 그대로 사용 시도`);
                // 이미지 로드 실패해도 base64 데이터는 있으므로 계속 진행
                resolve();
              };
            });
            
            // 이미지 로드가 실패했어도 base64 데이터가 있으면 사용
            if (!img && base64ImageData && base64ImageData.length > 0) {
              console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 데이터 직접 사용 (이미지 로드 실패했지만 base64 데이터는 유효)`);
            }
            
            console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64ImageData 준비 완료, 길이:`, base64ImageData.length);
          } catch (base64Error) {
            // base64 처리 중 예외 발생 시에도 base64 데이터가 있으면 사용 시도
            console.warn(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 처리 중 오류, base64 데이터 직접 사용 시도:`, base64Error);
            if (inspectionCert.base64) {
              base64ImageData = inspectionCert.base64.includes(',') 
                ? inspectionCert.base64.split(',')[1] 
                : inspectionCert.base64;
              console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 데이터 직접 사용, 길이:`, base64ImageData.length);
            } else {
              base64ImageData = '';
            }
          }
        }
        
        // base64 데이터가 없거나 base64 로드가 실패한 경우 URL로 다운로드
        if (!base64ImageData || base64ImageData.length === 0) {
          // 이미지 다운로드
          // finalUrl이 있으면 사용, 없으면 inspectionCert.url 사용
          const imageUrl = finalUrl || inspectionCert.url || '';
          console.log('[PDF 생성] 이미지 다운로드 시작, URL:', imageUrl, 'storagePath:', inspectionCert.storagePath);
          
          let blob: Blob | null = null;
          let downloadSuccess = false;
          
          // 방법 1: storagePath가 있으면 getDownloadURL 사용 (재시도 로직 포함, 재시도 횟수 증가)
          if (inspectionCert.storagePath) {
            const maxRetries = 5; // 재시도 횟수 증가: 2 → 5
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                console.log(`[PDF 생성] getDownloadURL 시도 ${attempt}/${maxRetries}, storagePath:`, inspectionCert.storagePath);
                const storageRef = ref(storage, inspectionCert.storagePath);
                
                // getDownloadURL로 URL 가져오기 (타임아웃 90초로 증가)
                const downloadURL = await Promise.race([
                  getDownloadURL(storageRef),
                  new Promise<string>((_, reject) => 
                    setTimeout(() => reject(new Error(`getDownloadURL 타임아웃 (90초) - 시도 ${attempt}/${maxRetries}`)), 90000)
                  )
                ]);
                
                console.log('[PDF 생성] getDownloadURL 완료, URL:', downloadURL);
                
              // URL로 fetch (타임아웃 60초)
              try {
                let response: Response | null = null;
                try {
                  const fetchPromise = fetch(downloadURL, {
                    method: 'GET',
                    headers: {
                      'Accept': 'image/*',
                    },
                  }).catch(() => {
                    // fetch 실패 시 null 반환
                    return null;
                  });
                  
                  const timeoutPromise = new Promise<Response | null>((resolve) => 
                    setTimeout(() => resolve(null), 60000)
                  );
                  
                  response = await Promise.race([fetchPromise, timeoutPromise]);
                } catch (fetchErr) {
                  // fetch 에러 발생 시 null로 처리하고 계속 진행
                  console.warn(`[PDF 생성] fetch 에러 (시도 ${attempt}/${maxRetries}), 이미지 건너뜀:`, fetchErr);
                  response = null;
                }
                
                if (!response || !response.ok) {
                  console.warn(`[PDF 생성] HTTP 에러 (status: ${response?.status || 'unknown'}), 이미지 건너뜀`);
                  downloadSuccess = false;
                  continue; // 다음 시도로
                }
                
                blob = await response.blob();
                console.log('[PDF 생성] storagePath를 통한 다운로드 완료, 크기:', blob.size);
                downloadSuccess = true;
                break; // 성공하면 루프 종료
              } catch (fetchError) {
                // fetch 에러 발생 시 이번 시도 실패로 처리하고 다음 시도로
                console.warn(`[PDF 생성] fetch 실패 (시도 ${attempt}/${maxRetries}), 이미지 건너뜀:`, fetchError);
                if (attempt === maxRetries) {
                  // 마지막 시도 실패 시 URL로 재시도하도록 break
                  break;
                }
                // 재시도 전 잠시 대기
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
              }
              } catch (storageError) {
                const code =
                  typeof storageError === 'object' && storageError !== null && 'code' in storageError
                    ? String((storageError as { code?: unknown }).code)
                    : undefined;
                const msg = storageError instanceof Error ? storageError.message : String(storageError);
                if (code === 'storage/object-not-found') {
                  console.warn(
                    `[PDF 생성] storagePath 객체가 존재하지 않음(누락) - 제품 ${index + 1} 파일 ${certIndex + 1}, 시도 ${attempt}/${maxRetries}:`,
                    msg
                  );
                } else {
                  console.warn(
                    `[PDF 생성] storagePath 다운로드 시도 ${attempt}/${maxRetries} 실패 - 제품 ${index + 1} 파일 ${certIndex + 1}:`,
                    msg
                  );
                }
                if (attempt === maxRetries) {
                  // 마지막 시도 실패 시 URL로 재시도
                  console.log('[PDF 생성] 모든 storagePath 시도 실패, URL로 재시도');
                } else {
                  // 재시도 전 잠시 대기
                  await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                }
              }
            }
          }
          
          // 방법 2: storagePath 다운로드 실패했거나 storagePath가 없으면 기존 URL로 다운로드
          if (!downloadSuccess && (imageUrl || inspectionCert.url)) {
            try {
              const urlToUse = imageUrl || inspectionCert.url || '';
              console.log('[PDF 생성] URL로 다운로드 시도:', urlToUse);
              // 타임아웃 60초로 설정
              let response: Response | null = null;
              try {
                const fetchPromise = fetch(urlToUse, {
                  method: 'GET',
                  headers: {
                    'Accept': 'image/*',
                  },
                }).catch(() => {
                  // fetch 실패 시 null 반환
                  return null;
                });
                
                const timeoutPromise = new Promise<Response | null>((resolve) => 
                  setTimeout(() => resolve(null), 60000)
                );
                
                response = await Promise.race([fetchPromise, timeoutPromise]);
              } catch (fetchErr) {
                // fetch 에러 발생 시 null로 처리하고 계속 진행
                console.warn('[PDF 생성] URL fetch 에러, 이미지 건너뜀:', fetchErr);
                response = null;
              }
              
              if (!response || !response.ok) {
                console.warn(`[PDF 생성] HTTP 에러 (status: ${response?.status || 'unknown'}), 이미지 건너뜀`);
                downloadSuccess = false;
              } else {
                blob = await response.blob();
                console.log('[PDF 생성] URL 다운로드 완료, 크기:', blob.size);
                downloadSuccess = true;
              }
            } catch (fetchError) {
              // 에러 발생 시 해당 이미지를 건너뛰고 계속 진행
              console.warn('[PDF 생성] URL 다운로드 실패, 이미지 건너뜀:', fetchError);
              downloadSuccess = false;
              failedImageCount++;
              const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
              console.warn(`⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) 이미지를 다운로드하지 못했습니다: ${errorMsg} (실패한 이미지: ${failedImageCount}개)`);
              // 에러를 throw하지 않고 continue로 다음 이미지로 넘어감
              continue;
            }
          }
          
          if (!downloadSuccess || !blob) {
            // create 페이지와 동일하게 이미지 데이터가 없으면 해당 파일은 건너뜀
            failedImageCount++;
            const errorMsg = `이미지 다운로드에 실패했습니다. storagePath와 URL 모두 사용할 수 없습니다.`;
            console.warn(
              `⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) ${errorMsg} (실패한 이미지: ${failedImageCount}개)`
            );
            continue;
          } else {
            // Blob을 base64로 변환
            const base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                  resolve(reader.result);
                } else {
                  reject(new Error('FileReader result is not a string'));
                }
              };
              reader.onerror = () => reject(new Error('FileReader error'));
              reader.readAsDataURL(blob);
            });
            
            base64ImageData = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
            console.log('[PDF 생성] base64 변환 완료, 길이:', base64ImageData.length);
            
            // 이미지 크기 확인 (타임아웃 증가: 60초)
            const urlImg = new Image();
            urlImg.src = base64Data;
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                console.warn('[PDF 생성] 이미지 크기 확인 타임아웃, base64 데이터는 그대로 사용');
                resolve(); // 타임아웃이어도 base64 데이터는 있으므로 계속 진행
              }, 60000); // 60초로 증가
              urlImg.onload = () => {
                clearTimeout(timeout);
                console.log('[PDF 생성] 이미지 크기 확인 완료:', urlImg.width, 'x', urlImg.height);
                resolve();
              };
              urlImg.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('이미지 로드 실패'));
              };
            });
            img = urlImg;
          }
        }
        
        // Inspection Certificate 이미지는 항상 landscape(가로) 모드로 표시
        // 새로운 페이지 추가 (A4 landscape 크기: 297mm x 210mm)
        doc.addPage([297, 210], 'landscape');
        
        // 이미지 페이지는 여백을 최소화 (가로 여백 5mm)
        const imageMargin = 5;
        yPosition = imageMargin + 5;
        
        // 제목 표시 (여러 파일인 경우 No.1-1, No.1-2 형식)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        const certTitle = inspectionCerts.length > 1 
          ? `INSPECTION CERTIFICATE (No.${index + 1}-${certIndex + 1})`
          : `INSPECTION CERTIFICATE (No.${index + 1})`;
        
        console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} 제목 추가:`, certTitle);
        doc.text(certTitle, imageMargin, yPosition);
        yPosition += 10;
        
        // create 페이지와 동일: base64가 없으면 placeholder를 만들지 않고 건너뜀
        if (!base64ImageData || base64ImageData.length === 0) {
          console.warn(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64ImageData가 없습니다. 건너뜀.`);
          failedImageCount++;
          continue;
        }

        // img 로딩 실패(img==null)여도 base64는 있을 수 있습니다.
        // 이 경우 기본 비율(1:1)로라도 doc.addImage를 시도해서 페이지가 렌더링되게 합니다.
        const hasImg = !!img;
        
        // 이미지 크기 계산 (가로 여백 최소화)
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const availableWidth = pageWidth - imageMargin * 2;
        const availableHeight = pageHeight - yPosition - imageMargin - 5;

        // img가 있으면 실제 비율로, 없으면 기본 1:1 비율로 계산
        const aspectRatio = hasImg && img!.width > 0 ? img!.height / img!.width : 1;

        const imgWidthMM = availableWidth;
        const imgHeightMM = aspectRatio * availableWidth;

        // 세로가 페이지를 넘어가면 세로 기준으로 조정
        let finalWidthMM = imgWidthMM;
        let finalHeightMM = imgHeightMM;
        if (imgHeightMM > availableHeight) {
          finalHeightMM = availableHeight;
          finalWidthMM = aspectRatio > 0 ? (availableHeight / aspectRatio) : availableWidth;
        }
        
        // 이미지를 페이지 중앙에 배치 (가로 여백 최소화)
        const imgX = imageMargin;
        const imgY = yPosition;
        
        console.log(`[PDF 생성] 제품 ${index + 1} 이미지 추가 시도:`, {
          imageFormat,
          imgWidthMM: finalWidthMM,
          imgHeightMM: finalHeightMM,
          imgX,
          imgY,
          base64Length: base64ImageData.length,
          imgWidth: hasImg ? img!.width : 0,
          imgHeight: hasImg ? img!.height : 0,
        });
        
        // 이미지 추가
        try {
          doc.addImage(base64ImageData, imageFormat, imgX, imgY, finalWidthMM, finalHeightMM);

          successfullyAddedCount++;
          console.log(
            `[PDF 생성] ✅ 제품 ${index + 1} "${product.productName}" 파일 ${certIndex + 1}/${inspectionCerts.length} "${inspectionCert.name}" 이미지 추가 완료 - 페이지 번호: ${doc.getNumberOfPages()}, 제목: ${certTitle}`
          );
          console.log(
            `[PDF 생성] 제품 ${index + 1} "${product.productName}" 진행 상황: ${certIndex + 1}/${inspectionCerts.length}개 파일 추가 완료 (성공: ${successfullyAddedCount}개)`
          );

          // 검증 결과: 성공적으로 포함됨
          productValidationResult.files.push({
            fileName: inspectionCert.name || '이름 없음',
            status: 'rendered_image',
          });
        } catch (addImageError) {
          console.error(`[PDF 생성] doc.addImage 실패:`, addImageError);
          const errorMsg = addImageError instanceof Error ? addImageError.message : String(addImageError);
          
          // 검증 결과: PDF 추가 실패
          productValidationResult.files.push({
            fileName: inspectionCert.name || '이름 없음',
            status: 'failed',
            error: `PDF에 이미지 추가 실패: ${errorMsg}`,
          });
          // 이미지 1개가 실패해도 PDF 전체 생성을 중단하지 않음.
          // (삭제/재등록 직후 base64/URL이 잠깐 비정상일 수 있어 미리보기/저장이 막히는 문제 방지)
          failedImageCount++;
          continue;
        }
        
      } catch (error) {
        // 이미지 로드 실패 시 에러 로그 출력
        failedImageCount++;
        
        // 에러 정보 수집
        const errorInfo: Record<string, unknown> = {
          url: inspectionCert.url,
          name: inspectionCert.name,
          type: inspectionCert.type,
        };
        
        if (error instanceof Error) {
          errorInfo.errorMessage = error.message;
          errorInfo.errorName = error.name;
          errorInfo.errorStack = error.stack;
        } else if (error) {
          errorInfo.errorString = String(error);
          errorInfo.errorType = typeof error;
          errorInfo.errorKeys = Object.keys(error as Record<string, unknown>);
        } else {
          errorInfo.error = '알 수 없는 에러 (null/undefined)';
        }
        
        console.error(`제품 ${index + 1}의 이미지 로드 실패:`, error);
        console.error('에러 상세:', errorInfo);
        
        // 에러가 발생해도 다음 파일 계속 처리
        console.warn(`⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) 이미지를 PDF에 추가하지 못했습니다. (실패한 이미지: ${failedImageCount}개)`);
        // 에러가 발생해도 PDF 생성은 계속 진행 (이미지 없이)
        continue; // 이 파일은 건너뛰고 다음 파일로
      }
      }
    }
    
    if (inspectionCerts.length === 0) {
      console.log(`[PDF 생성] 제품 ${index + 1}에는 Inspection Certificate가 없습니다.`);
    }
    
    // 제품별 검증 결과를 전체 결과에 추가
    if (productValidationResult.files.length > 0 || inspectionCerts.length > 0) {
      fileValidationResults.push(productValidationResult);
    }
  }
  
  console.log(`[PDF 생성] 모든 이미지 처리 완료. 총 페이지 수: ${doc.getNumberOfPages()}, 실패한 이미지: ${failedImageCount}개`);
  console.log(`[PDF 생성] 파일 검증 결과:`, fileValidationResults.map((r: ProductValidationResult) => ({
    product: r.productName,
    totalFiles: r.files.length,
    renderedFiles: r.files.filter((f: FileValidationResult) => f.status === 'rendered_image').length,
    keptAsAttachmentFiles: r.files.filter((f: FileValidationResult) => f.status === 'kept_as_attachment').length,
    failedFiles: r.files.filter((f: FileValidationResult) => f.status === 'failed').length,
    files: r.files.map((f: FileValidationResult) => ({
      name: f.fileName,
      status: f.status,
      error: f.error,
    })),
  })));

  // 하단 정보 (DEFAULT 고정 내용은 나중에 추가)
  // 주석 처리: 사용자가 요청할 때까지 표시하지 않음
  // yPosition = pageHeight - 30;
  // doc.setFontSize(8);
  // doc.setFont('helvetica', 'italic');
  // doc.text('* DEFAULT 고정 내용은 추후 추가 예정입니다.', margin, yPosition);

  // PDF를 Blob으로 변환하여 반환
  try {
    const pdfBlob = doc.output('blob');
    console.log(`[PDF 생성] 완료. 실패한 이미지: ${failedImageCount}개`);
    return { 
      blob: pdfBlob, 
      failedImageCount,
      fileValidationResults,
    };
  } catch (error) {
    console.error('PDF 생성 오류:', error);
    // PDF 생성 실패 시 빈 PDF 반환 (에러 방지)
    const jspdfFallbackModule = (await import('jspdf/dist/jspdf.umd.min.js')) as unknown as Partial<{
      jsPDF: (typeof import('jspdf'))['jsPDF'];
      default: (typeof import('jspdf'))['jsPDF'];
    }>;
    const jsPDFFallback = jspdfFallbackModule.jsPDF ?? jspdfFallbackModule.default;
    if (!jsPDFFallback) {
      throw new Error('jsPDF fallback 로드 실패');
    }
    const fallbackDoc = new jsPDFFallback({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    fallbackDoc.text('PDF 생성 중 오류가 발생했습니다.', 20, 20);
    return { 
      blob: fallbackDoc.output('blob'), 
      failedImageCount,
      fileValidationResults: [], // 에러 발생 시 빈 배열 반환
    };
  }
};

const mergePdfAttachments = async (
  basePdfBlob: Blob,
  products: CertificateProduct[]
): Promise<{
  mergedBlob: Blob;
  mergedAttachmentKeys: Set<string>;
  failedPdfAttachments: Array<{ fileName: string; error?: string }>;
}> => {
  const { PDFDocument } = await import('pdf-lib');
  const mergedAttachmentKeys = new Set<string>();
  const failedPdfAttachments: Array<{ fileName: string; error?: string }> = [];

  const basePdfBytes = await basePdfBlob.arrayBuffer();
  const outputPdf = await PDFDocument.load(basePdfBytes);

  for (const product of products) {
    const productWithCerts = product as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
    const certs = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
      ? productWithCerts.inspectionCertificates
      : (product.inspectionCertificate ? [product.inspectionCertificate] : []);

    for (const cert of certs) {
      if (getAttachmentKind(cert) !== 'pdf') continue;
      const identityKey = getAttachmentIdentityKey(cert);
      try {
        let pdfBlob: Blob | null = null;
        if (cert.storagePath && cert.storagePath.trim().length > 0) {
          try {
            pdfBlob = await getBlob(ref(storage, cert.storagePath));
          } catch {
            // URL fetch fallback
          }
        }
        if (!pdfBlob && cert.url && cert.url.trim().length > 0) {
          const res = await fetch(cert.url);
          if (res.ok) pdfBlob = await res.blob();
        }
        if (!pdfBlob) {
          failedPdfAttachments.push({ fileName: cert.name || '이름 없음', error: 'PDF 첨부 파일 blob을 읽지 못했습니다.' });
          continue;
        }

        const attachPdf = await PDFDocument.load(await pdfBlob.arrayBuffer());
        const pageIndexes = Array.from({ length: attachPdf.getPageCount() }, (_, i) => i);
        const copiedPages = await outputPdf.copyPages(attachPdf, pageIndexes);
        copiedPages.forEach((p) => outputPdf.addPage(p));
        mergedAttachmentKeys.add(identityKey);
      } catch (error) {
        failedPdfAttachments.push({
          fileName: cert.name || '이름 없음',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const outBytes = await outputPdf.save();
  const outArrayBuffer = outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteOffset + outBytes.byteLength) as ArrayBuffer;
  return {
    mergedBlob: new Blob([outArrayBuffer], { type: 'application/pdf' }),
    mergedAttachmentKeys,
    failedPdfAttachments,
  };
};

// 관리자 인증 확인 함수
const checkAdminAuth = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  const sessionData = localStorage.getItem(ADMIN_SESSION_KEY);
  if (!sessionData) return false;
  
  try {
    const session = JSON.parse(sessionData);
    const now = new Date().getTime();
    
    if (now > session.expiresAt) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    
    return session.authenticated === true;
  } catch {
    return false;
  }
};

// Firebase 인증 상태 확인 및 익명 인증 시도 (Firestore 접근을 위해)
const ensureFirebaseAuth = async (): Promise<void> => {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
      console.log('[관리자] Firebase 익명 인증 완료');
    } catch (error) {
      console.warn('[관리자] Firebase 익명 인증 실패:', error);
      // 실패해도 계속 진행 (관리자 세션이 있으면)
    }
  }
};

// 파일명에서 Material과 Heat No. 추출하는 헬퍼 함수
const extractMaterialAndHeatNo = (fileName: string): { material: string; heatNo: string } => {
  let material = '';
  let heatNo = '';
  
  // 확장자 제거 (예: .pdf, .jpg 등)
  const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
  // 파일명을 '-'로 분리
  // 예: 316-11.11-S45123-210225 -> ['316', '11.11', 'S45123', '210225']
  const parts = nameWithoutExt.split('-');
  
  // 첫 번째 부분이 Material (소재 정보)
  const materialCode = parts[0]?.trim();
  if (materialCode === '316') {
    material = '316/316L';
  } else if (materialCode === '304') {
    material = '304';
  } else if (materialCode) {
    material = materialCode; // 다른 소재 코드도 그대로 사용
  }
  
  // Heat No. 파트 찾기
  // 예: S58897, N27612 처럼 앞이 S 또는 N인 케이스를 모두 지원
  const heatNoPart = parts.find((part) => {
    const p = part.trim().toUpperCase();
    return /^[SN]\d+/.test(p);
  });
  
  // 마지막 부분에서 6자리 숫자 추출 (YYMMDD 형식)
  // 예: "250922[GME04]" -> "250922" 추출
  const lastPart = parts[parts.length - 1];
  let dateStr = '';
  if (lastPart) {
    // 6자리 연속 숫자 패턴 찾기
    const dateMatch = lastPart.match(/\d{6}/);
    if (dateMatch) {
      const datePart = dateMatch[0];
      // YYMMDD -> YYYY-MM-DD 변환
      const yy = parseInt(datePart.substring(0, 2), 10);
      const mm = datePart.substring(2, 4);
      const dd = datePart.substring(4, 6);
      // 2000년대 가정 (00-50: 2000-2050, 51-99: 1951-1999)
      const yyyy = yy <= 50 ? 2000 + yy : 1900 + yy;
      dateStr = `${yyyy}-${mm}-${dd}`;
    }
  }
  
  if (heatNoPart) {
    const heatNoValue = heatNoPart.trim().toUpperCase();
    // Heat No.와 날짜를 함께 표시
    heatNo = dateStr ? `${heatNoValue} / ${dateStr}` : heatNoValue;
  }
  
  return { material, heatNo };
};

// 모든 파일에서 Material과 Heat No. 수집하는 함수 (파일 구분 제거)
const collectMaterialAndHeatNo = (
  inspectionCertificates: Array<CertificateAttachment | File>
): { material: string; heatNo: string } => {
  const materials: string[] = []; // Set 대신 배열 사용하여 파일 순서대로 수집
  const heatNos: string[] = [];
  
  // 모든 파일 처리 (File 객체와 CertificateAttachment 모두)
  for (const item of inspectionCertificates) {
    let fileName: string;
    if (item instanceof File) {
      fileName = item.name;
    } else {
      fileName = item.name;
    }
    
    const { material, heatNo } = extractMaterialAndHeatNo(fileName);
    if (material) {
      materials.push(material); // 중복 제거하지 않고 순서대로 추가
    }
    if (heatNo) {
      heatNos.push(heatNo);
    }
  }
  
  
  // Material은 쉼표로 구분하여 결합 (중복 허용)
  const materialStr = materials.join(', ');
  // Heat No.는 쉼표로 구분하여 결합
  const heatNoStr = heatNos.join(', ');
  
  return { material: materialStr, heatNo: heatNoStr };
};

function MaterialTestCertificateEditContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const isV2Flow = searchParams.get('flow') === 'v2';
  const certificateId = params?.id as string; // 동적 라우트에서 id 가져오기
  const [loadingCertificate, setLoadingCertificate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // 필드별 에러 메시지 상태
  const [formErrors, setFormErrors] = useState<{
    certificateNo?: string;
    dateOfIssue?: string;
    customer?: string;
    poNo?: string;
    products?: Array<{
      productName?: string;
      productCode?: string;
      quantity?: string;
    }>;
  }>({});

  // MATERIAL TEST CERTIFICATE 입력 항목
  const [formData, setFormData] = useState({
    certificateNo: '',        // CERTIFICATE NO.
    dateOfIssue: '',          // DATE OF ISSUE
    customer: '',             // CUSTOMER
    poNo: '',                 // PO NO.
    testResult: '',           // TEST RESULT
  });
  

  // 제품 배열 (제품명, 제품코드, 수량, 히트번호, Material, Remark, Inspection Certi)
  // 파일 구분 제거: 모든 파일을 하나의 배열로 통합 (File 객체는 새 파일, CertificateAttachment는 기존 파일)
  const [products, setProducts] = useState<Array<{
    productName: string;
    productCode: string;
    quantity: string;
    heatNo: string;
    material: string;
    remark: string;
    inspectionCertificates: Array<CertificateAttachment | File>;
  }>>([{ productName: '', productCode: '', quantity: '', heatNo: '', material: '', remark: '', inspectionCertificates: [] }]);

  // 제품명코드 매핑 모달 (새 제품명 입력 시 매핑 없을 때 팝업)
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [currentProductIndex, setCurrentProductIndex] = useState<number | null>(null);
  const [currentProductCode, setCurrentProductCode] = useState<string>('');
  const [allMappings, setAllMappings] = useState<ProductMapping[]>([]);
  const [showMappingList, setShowMappingList] = useState(false);
  const [mappingSearchQuery, setMappingSearchQuery] = useState('');
  const [editingMapping, setEditingMapping] = useState<ProductMapping | null>(null);
  const attachmentsHydratedRef = useRef(false);
  const [removedAttachmentKeys, setRemovedAttachmentKeys] = useState<Set<string>>(new Set());
  const [loadedExistingAttachmentsByIndex, setLoadedExistingAttachmentsByIndex] = useState<CertificateAttachment[][]>([]);
  const [touchedAttachmentProductIndexes, setTouchedAttachmentProductIndexes] = useState<Set<number>>(new Set());
  const initialEditFingerprintRef = useRef<string>('');

  const buildEditFingerprint = (
    nextFormData: {
      certificateNo: string;
      dateOfIssue: string;
      customer: string;
      poNo: string;
      testResult: string;
    },
    nextProducts: Array<{
      productName: string;
      productCode: string;
      quantity: string;
      heatNo: string;
      material: string;
      remark: string;
      inspectionCertificates: Array<CertificateAttachment | File>;
    }>
  ): string => {
    const normalized = {
      formData: {
        certificateNo: nextFormData.certificateNo.trim(),
        dateOfIssue: nextFormData.dateOfIssue.trim(),
        customer: nextFormData.customer.trim(),
        poNo: nextFormData.poNo.trim(),
        testResult: nextFormData.testResult.trim(),
      },
      products: (nextProducts || []).map((p) => ({
        productName: (p.productName || '').trim(),
        productCode: (p.productCode || '').trim(),
        quantity: (p.quantity || '').trim(),
        heatNo: (p.heatNo || '').trim(),
        material: (p.material || '').trim(),
        remark: (p.remark || '').trim(),
        inspectionCertificates: (p.inspectionCertificates || []).map((item) => {
          if (item instanceof File) {
            return {
              kind: 'file',
              name: item.name || '',
              size: item.size || 0,
              type: item.type || '',
              lastModified: item.lastModified || 0,
            };
          }
          return {
            kind: 'attachment',
            name: item.name || '',
            url: item.url || '',
            storagePath: item.storagePath || '',
            size: item.size || 0,
            type: item.type || '',
          };
        }),
      })),
    };
    return JSON.stringify(normalized);
  };

  // 관리자 인증 확인 및 Firebase 인증 확인
  useEffect(() => {
    if (!checkAdminAuth()) {
      router.push('/admin/login');
      return;
    }
    // 관리자 세션이 있으면 Firebase 인증 상태 확인 및 익명 인증 시도
    ensureFirebaseAuth();
  }, [router]);

  // 성적서 정보 불러오기 (수정 모드)
  useEffect(() => {
    const loadCertificateData = async () => {
      if (!certificateId) {
        setError('성적서 ID가 필요합니다. 성적서 목록에서 수정 버튼을 클릭해주세요.');
        setTimeout(() => {
          router.push(isV2Flow ? '/admin/certificate/list2' : '/admin/certificate');
        }, 3000);
        return;
      }

      attachmentsHydratedRef.current = false;
      initialEditFingerprintRef.current = '';
      setRemovedAttachmentKeys(new Set());
      setTouchedAttachmentProductIndexes(new Set());
      setLoadingCertificate(true);
      try {
        const certDoc = await getDoc(doc(db, 'certificates', certificateId));
        if (!certDoc.exists()) {
          setError('성적서를 찾을 수 없습니다.');
          setTimeout(() => {
            router.push(isV2Flow ? '/admin/certificate/list2' : '/admin/certificate');
          }, 3000);
          setLoadingCertificate(false);
          return;
        }

        const data = certDoc.data();

        // 수정 화면에서 첨부 fallback은 최초 요청 원본(data.products)을 기준으로 사용
        const requestProducts =
          data.products && Array.isArray(data.products) ? data.products : [];

        const toAttachmentFromUnknown = (raw: unknown): CertificateAttachment | null => {
          if (!raw || typeof raw !== 'object') return null;
          const record = raw as Record<string, unknown>;
          const uploadedAtCandidate = record.uploadedAt;
          return {
            name: typeof record.name === 'string' ? record.name : '',
            url: typeof record.url === 'string' ? record.url : '',
            storagePath: typeof record.storagePath === 'string' ? record.storagePath : undefined,
            size: typeof record.size === 'number' ? record.size : 0,
            type: typeof record.type === 'string' ? record.type : '',
            uploadedAt:
              uploadedAtCandidate && typeof uploadedAtCandidate === 'object' && 'toDate' in uploadedAtCandidate
                ? (uploadedAtCandidate as { toDate: () => Date }).toDate()
                : (uploadedAtCandidate instanceof Date ? uploadedAtCandidate : new Date()),
            uploadedBy: typeof record.uploadedBy === 'string' ? record.uploadedBy : 'admin',
          };
        };

        const extractAttachmentsFromUnknownProduct = (rawProduct: unknown): CertificateAttachment[] => {
          if (!rawProduct || typeof rawProduct !== 'object') return [];
          const productRecord = rawProduct as Record<string, unknown>;
          const fromArray = Array.isArray(productRecord.inspectionCertificates)
            ? productRecord.inspectionCertificates.map(toAttachmentFromUnknown).filter(Boolean) as CertificateAttachment[]
            : [];
          if (fromArray.length > 0) return fromArray;
          const single = toAttachmentFromUnknown(productRecord.inspectionCertificate);
          return single ? [single] : [];
        };

        // 기존 MATERIAL TEST CERTIFICATE 내용이 있으면 불러오기 (수정 모드)
        if (data.materialTestCertificate) {
            const mtc = data.materialTestCertificate;
            const loadedFormData = {
              certificateNo: mtc.certificateNo || '',
              dateOfIssue: mtc.dateOfIssue?.toDate().toISOString().split('T')[0] || '',
              customer: mtc.customer || '',
              poNo: mtc.poNo || '',
              testResult: mtc.testResult || '',
            };
            setFormData(loadedFormData);
            
            // 제품 데이터 로드 (products 배열이 있으면 사용, 없으면 기존 단일 제품 필드 사용)
            let loadedProducts: typeof products = [];
            if (mtc.products && Array.isArray(mtc.products) && mtc.products.length > 0) {
              loadedProducts = mtc.products.map((p: CertificateProduct, index: number) => {
                // 원본 성적서 요청 데이터에서 remark 가져오기 (materialTestCertificate에 없을 경우 fallback)
                // 제품명과 제품코드로 매칭하여 더 정확하게 찾기
                const originalProduct = requestProducts.find((op: CertificateProduct) => 
                  op.productName === p.productName && op.productCode === p.productCode
                ) || requestProducts[index] as CertificateProduct | undefined;
                
                const remarkValue = p.remark || originalProduct?.remark || '';
                console.log(`[로드] 제품 "${p.productName || '이름 없음'}" remark 로드:`, {
                  mtcRemark: p.remark,
                  originalRemark: originalProduct?.remark,
                  finalRemark: remarkValue,
                  hasOriginalProduct: !!originalProduct
                });
                
                // inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
                const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
                let existingCerts: CertificateAttachment[] = [];
                
                if (productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)) {
                  // Firestore에서 로드한 데이터 변환 (Timestamp를 Date로 변환)
                  console.log(`[로드] 제품 "${p.productName || '이름 없음'}" inspectionCertificates 배열 발견:`, productWithCerts.inspectionCertificates.length, '개');
                  existingCerts = productWithCerts.inspectionCertificates.map((cert: CertificateAttachment, idx: number) => {
                    const certData: CertificateAttachment = {
                      name: cert.name || '',
                      url: cert.url || '',
                      storagePath: cert.storagePath || undefined,
                      size: cert.size || 0,
                      type: cert.type || '',
                      uploadedAt: cert.uploadedAt && typeof cert.uploadedAt === 'object' && 'toDate' in cert.uploadedAt
                        ? (cert.uploadedAt as { toDate: () => Date }).toDate()
                        : (cert.uploadedAt instanceof Date ? cert.uploadedAt : new Date()),
                      uploadedBy: cert.uploadedBy || 'admin',
                    };
                    console.log(`[로드] 제품 "${p.productName || '이름 없음'}" 파일 ${idx + 1}:`, {
                      name: certData.name,
                      url: certData.url ? '있음' : '없음',
                      storagePath: certData.storagePath ? '있음' : '없음',
                      storagePathValue: certData.storagePath,
                    });
                    return certData;
                  });
                } else if (p.inspectionCertificate) {
                  // 단일 객체를 배열로 변환
                  console.log(`[로드] 제품 "${p.productName || '이름 없음'}" inspectionCertificate 단일 객체 발견`);
                  const cert = p.inspectionCertificate;
                  existingCerts = [{
                    name: cert.name || '',
                    url: cert.url || '',
                    storagePath: cert.storagePath || undefined,
                    size: cert.size || 0,
                    type: cert.type || '',
                    uploadedAt: cert.uploadedAt && typeof cert.uploadedAt === 'object' && 'toDate' in cert.uploadedAt
                      ? (cert.uploadedAt as { toDate: () => Date }).toDate()
                      : (cert.uploadedAt instanceof Date ? cert.uploadedAt : new Date()),
                    uploadedBy: cert.uploadedBy || 'admin',
                  }];
                } else {
                  console.log(`[로드] 제품 "${p.productName || '이름 없음'}" Inspection Certificate 없음`);
                }

                // mtc.products에 첨부가 비어 있으면 sourceProducts fallback 사용
                if (existingCerts.length === 0 && originalProduct) {
                  const fallbackCerts = extractAttachmentsFromUnknownProduct(originalProduct);
                  if (fallbackCerts.length > 0) {
                    existingCerts = fallbackCerts;
                    console.log(
                      `[로드] 제품 "${p.productName || '이름 없음'}" 요청 원본 첨부 fallback 적용: ${fallbackCerts.length}개`
                    );
                  }
                }
                
                console.log(`[로드] 제품 "${p.productName || '이름 없음'}" 최종 기존 파일 개수:`, existingCerts.length);
                console.log(`[로드] 제품 "${p.productName || '이름 없음'}" 최종 기존 파일 목록:`, existingCerts.map((c, idx) => ({ 
                  index: idx + 1,
                  name: c.name, 
                  url: c.url,
                  hasUrl: !!c.url && c.url.trim().length > 0,
                })));
                
                // 모든 파일에서 Material과 Heat No. 추출
                const { material, heatNo } = collectMaterialAndHeatNo(existingCerts);
                console.log(`[로드] 제품 "${p.productName || '이름 없음'}" 기존 파일에서 추출한 Material:`, material, 'Heat No.:', heatNo);
                
                // productNameCode가 있고 productCode가 "제품명코드-" 형식이면 CODE 자동 생성
                let finalProductCode = p.productCode || '';
                if (p.productNameCode && finalProductCode) {
                  // 이미 "제품명코드-제품코드" 형식이면 그대로 사용
                  if (finalProductCode.startsWith(`${p.productNameCode}-`)) {
                    // 그대로 사용
                  } else {
                    // "제품명코드-"로 시작하지 않으면 자동 생성
                    finalProductCode = `${p.productNameCode}-${finalProductCode}`;
                  }
                }
                
                return {
                  productName: p.productName || '',
                  productCode: finalProductCode,
                  quantity: p.quantity?.toString() || '',
                  heatNo: heatNo || p.heatNo || '',
                  material: material || p.material || '',
                  remark: remarkValue,
                  inspectionCertificates: existingCerts, // 모든 파일을 하나의 배열로 통합
                };
              });
            } else if (mtc.description || mtc.code || mtc.quantity) {
              // 기존 단일 제품 데이터를 배열로 변환
              // inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
              const mtcWithCerts = mtc as MaterialTestCertificate & { inspectionCertificates?: CertificateAttachment[] };
              let existingCerts: CertificateAttachment[] = [];
              
              if (mtcWithCerts.inspectionCertificates && Array.isArray(mtcWithCerts.inspectionCertificates)) {
                // Firestore에서 로드한 데이터 변환 (Timestamp를 Date로 변환)
                existingCerts = mtcWithCerts.inspectionCertificates.map((cert: CertificateAttachment) => {
                  const certData: CertificateAttachment = {
                    name: cert.name || '',
                    url: cert.url || '',
                    storagePath: cert.storagePath || undefined,
                    size: cert.size || 0,
                    type: cert.type || '',
                    uploadedAt: cert.uploadedAt && typeof cert.uploadedAt === 'object' && 'toDate' in cert.uploadedAt
                      ? (cert.uploadedAt as { toDate: () => Date }).toDate()
                      : (cert.uploadedAt instanceof Date ? cert.uploadedAt : new Date()),
                    uploadedBy: cert.uploadedBy || 'admin',
                  };
                  return certData;
                });
              } else if (mtc.inspectionCertificate) {
                // 단일 객체를 배열로 변환
                const cert = mtc.inspectionCertificate;
                existingCerts = [{
                  name: cert.name || '',
                  url: cert.url || '',
                  storagePath: cert.storagePath || undefined,
                  size: cert.size || 0,
                  type: cert.type || '',
                  uploadedAt: cert.uploadedAt && typeof cert.uploadedAt === 'object' && 'toDate' in cert.uploadedAt
                    ? (cert.uploadedAt as { toDate: () => Date }).toDate()
                    : (cert.uploadedAt instanceof Date ? cert.uploadedAt : new Date()),
                  uploadedBy: cert.uploadedBy || 'admin',
                }];
              }

              if (existingCerts.length === 0) {
                const fallbackProduct = requestProducts[0] as CertificateProduct | undefined;
                const fallbackCerts = extractAttachmentsFromUnknownProduct(fallbackProduct);
                if (fallbackCerts.length > 0) {
                  existingCerts = fallbackCerts;
                  console.log(`[로드] 단일 제품 요청 원본 첨부 fallback 적용: ${fallbackCerts.length}개`);
                }
              }
              
              console.log(`[로드] 단일 제품 "${mtc.description || '이름 없음'}" 기존 파일 개수:`, existingCerts.length);
              console.log(`[로드] 단일 제품 "${mtc.description || '이름 없음'}" 기존 파일:`, existingCerts.map(c => ({ name: c.name, url: c.url })));
              
              // 모든 파일에서 Material과 Heat No. 추출
              const { material, heatNo } = collectMaterialAndHeatNo(existingCerts);
              console.log(`[로드] 단일 제품 "${mtc.description || '이름 없음'}" 기존 파일에서 추출한 Material:`, material, 'Heat No.:', heatNo);
              
              // 원본 성적서 요청 데이터에서 remark 가져오기 (fallback)
              // 제품명과 제품코드로 매칭하여 더 정확하게 찾기
              const originalProduct = requestProducts.find((op: CertificateProduct) => 
                op.productName === mtc.description && op.productCode === mtc.code
              ) || requestProducts[0] as CertificateProduct | undefined;
              
              const remarkValue = originalProduct?.remark || '';
              console.log(`[로드] 단일 제품 "${mtc.description || '이름 없음'}" remark 로드:`, {
                originalRemark: originalProduct?.remark,
                finalRemark: remarkValue,
                hasOriginalProduct: !!originalProduct
              });
              
              loadedProducts = [{
                productName: mtc.description || '',
                productCode: mtc.code || '',
                quantity: mtc.quantity?.toString() || '',
                heatNo: heatNo || mtc.heatNo || '',
                material: material || mtc.material || '',
                remark: remarkValue,
                inspectionCertificates: existingCerts, // 모든 파일을 하나의 배열로 통합
              }];
            }
            setProducts(loadedProducts);
            setLoadedExistingAttachmentsByIndex(
              loadedProducts.map((p) =>
                (p.inspectionCertificates || []).filter((item) => !(item instanceof File)) as CertificateAttachment[]
              )
            );
            initialEditFingerprintRef.current = buildEditFingerprint(loadedFormData, loadedProducts);
          } else {
            // 수정 페이지에서는 materialTestCertificate가 필수입니다
            setError('성적서 데이터가 없습니다. 성적서를 먼저 작성해주세요.');
            setTimeout(() => {
              router.push(isV2Flow ? '/admin/certificate/list2' : '/admin/certificate');
            }, 3000);
            setLoadingCertificate(false);
            return;
          }
      } catch (error) {
        console.error('성적서 데이터 로드 오류:', error);
        setError('성적서 데이터를 불러오는데 실패했습니다.');
      } finally {
        setLoadingCertificate(false);
      }
    };

    if (certificateId) {
      loadCertificateData();
    }
  }, [certificateId, router]);

  useEffect(() => {
    if (!certificateId || loadingCertificate || attachmentsHydratedRef.current) return;
    if (!products || products.length === 0) return;

    let cancelled = false;

    const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('FileReader result is not a string'));
        };
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsDataURL(blob);
      });

    const fetchUrlAsBase64DataUrl = async (url: string): Promise<string | null> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        const res = await fetch(url, { method: 'GET', headers: { Accept: 'image/*' }, signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await readBlobAsDataUrl(blob);
      } catch {
        return null;
      }
    };

    const normalizeFileName = (name: string): string => {
      const lower = (name || '').trim().toLowerCase();
      return lower.replace(/[^a-z0-9._-]/g, '');
    };

    const hydrateAttachmentUrls = async () => {
      let changed = false;
      let listedItems: Array<{ name: string; fullPath: string }> = [];

      try {
        const dirRef = ref(storage, `certificates/${certificateId}/inspection_certi`);
        const listed = await listAll(dirRef);
        listedItems = listed.items.map((itemRef) => ({
          name: itemRef.name || '',
          fullPath: itemRef.fullPath || '',
        }));
      } catch (error) {
        console.warn('[로드] inspection_certi 폴더 조회 실패(메타 기반 로드로 계속):', error);
      }

      const nextProducts = await Promise.all(
        products.map(async (product, productIndex) => {
          const currentFiles = product.inspectionCertificates || [];
          if (currentFiles.length === 0) return product;

          const nextFiles = await Promise.all(
            currentFiles.map(async (item) => {
              if (item instanceof File) return item;

              const cert = item as CertificateAttachment;
              const nextCert: CertificateAttachment = { ...cert };
              let resolvedUrl = nextCert.url || '';

              if ((!nextCert.storagePath || nextCert.storagePath.trim().length === 0) && nextCert.name) {
                const certName = normalizeFileName(nextCert.name);
                const matched = listedItems.find((listedItem) => {
                  const listedName = normalizeFileName(listedItem.name);
                  return listedName === certName || listedName.includes(certName) || certName.includes(listedName);
                });
                if (matched?.fullPath) {
                  nextCert.storagePath = matched.fullPath;
                  changed = true;
                }
              }

              if (nextCert.storagePath && nextCert.storagePath.trim().length > 0) {
                try {
                  const storageRef = ref(storage, nextCert.storagePath);
                  const refreshedUrl = await getDownloadURL(storageRef);
                  if (refreshedUrl && refreshedUrl !== resolvedUrl) {
                    nextCert.url = refreshedUrl;
                    resolvedUrl = refreshedUrl;
                    changed = true;
                  }
                } catch (error) {
                  console.warn('[로드] 첨부 URL 재동기화 실패(기존 값 유지):', nextCert.name, error);
                }
              }

              // storagePath로 URL을 못 찾았으면 기존 URL이 실제 접근 가능한지 검증
              if ((!resolvedUrl || resolvedUrl.trim().length === 0) && nextCert.url && nextCert.url.trim().length > 0) {
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 15000);
                  const response = await fetch(nextCert.url, { method: 'GET', signal: controller.signal });
                  clearTimeout(timeoutId);
                  if (response.ok) {
                    resolvedUrl = nextCert.url;
                  }
                } catch {
                  // 아래 정리 분기에서 처리
                }
              }

              // 실제 URL이 아직 확인되지 않아도 메타는 유지한다.
              // (저장 단계에서 storagePath/listAll 기반 복구를 다시 시도하기 위해 필요)
              if (!resolvedUrl || resolvedUrl.trim().length === 0) {
                return nextCert;
              }

              if ((!nextCert.base64 || nextCert.base64.trim().length === 0) && resolvedUrl.trim().length > 0) {
                const base64 = await fetchUrlAsBase64DataUrl(resolvedUrl);
                if (base64 && base64 !== nextCert.base64) {
                  nextCert.base64 = base64;
                  changed = true;
                }
              }

              nextCert.url = resolvedUrl;

              return nextCert;
            })
          );

          return { ...product, inspectionCertificates: nextFiles };
        })
      );

      // Storage의 최근 PNG를 직접 로드해 누락된 첨부를 보강
      // (메타가 비어도 최근 등록 파일이 수정 저장 시 PDF에 반영되도록 보장)
      const allExistingStoragePaths = new Set<string>();
      nextProducts.forEach((product) => {
        (product.inspectionCertificates || []).forEach((item) => {
          if (item instanceof File) return;
          const cert = item as CertificateAttachment;
          if (cert.storagePath && cert.storagePath.trim().length > 0) {
            allExistingStoragePaths.add(cert.storagePath.trim());
          }
        });
      });

      const pngCandidates = listedItems.filter((item) => {
        const lower = (item.name || '').toLowerCase();
        return (
          lower.endsWith('.png') ||
          lower.endsWith('.jpg') ||
          lower.endsWith('.jpeg') ||
          lower.endsWith('.webp')
        );
      });

      const missingImageCandidates = pngCandidates.filter(
        (item) => !allExistingStoragePaths.has((item.fullPath || '').trim())
      );

      if (missingImageCandidates.length > 0 && nextProducts.length > 0) {
        const loadedRecentAttachments: CertificateAttachment[] = [];
        for (const candidate of missingImageCandidates) {
          try {
            const storageRef = ref(storage, candidate.fullPath);
            const [downloadUrl, metadata] = await Promise.all([
              getDownloadURL(storageRef),
              getMetadata(storageRef).catch(() => null),
            ]);
            const fileName = candidate.name || '';
            const lowerName = fileName.toLowerCase();
            const inferredType =
              metadata?.contentType ||
              (lowerName.endsWith('.png')
                ? 'image/png'
                : lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
                  ? 'image/jpeg'
                  : lowerName.endsWith('.webp')
                    ? 'image/webp'
                    : 'image/png');

            loadedRecentAttachments.push({
              name: fileName,
              url: downloadUrl,
              storagePath: candidate.fullPath,
              size: typeof metadata?.size === 'number' ? metadata.size : 0,
              type: inferredType,
              uploadedAt: metadata?.updated ? new Date(metadata.updated) : new Date(),
              uploadedBy: 'admin',
            });
          } catch (error) {
            console.warn('[로드] 최근 이미지 직접 로드 실패(건너뜀):', candidate.fullPath, error);
          }
        }

        if (loadedRecentAttachments.length > 0) {
          // 최신 파일이 먼저 오도록 정렬 후 첫 제품에 보강
          loadedRecentAttachments.sort(
            (a, b) => (b.uploadedAt?.getTime?.() || 0) - (a.uploadedAt?.getTime?.() || 0)
          );
          const targetIndex = 0;
          const targetProduct = nextProducts[targetIndex];
          const currentCerts = (targetProduct.inspectionCertificates || []).filter(
            (item): item is CertificateAttachment => !(item instanceof File)
          );
          const merged = [...currentCerts, ...loadedRecentAttachments].filter((cert, idx, arr) => {
            const key = cert.storagePath && cert.storagePath.trim().length > 0
              ? `sp:${cert.storagePath.trim()}`
              : `nu:${cert.name || ''}::${cert.url || ''}`;
            return arr.findIndex((x) => {
              const xKey = x.storagePath && x.storagePath.trim().length > 0
                ? `sp:${x.storagePath.trim()}`
                : `nu:${x.name || ''}::${x.url || ''}`;
              return xKey === key;
            }) === idx;
          });
          nextProducts[targetIndex] = {
            ...targetProduct,
            inspectionCertificates: merged,
          };
          changed = true;
          console.log(`[로드] Storage 최근 이미지 직접 보강 적용: ${loadedRecentAttachments.length}개`);
        }
      }

      if (cancelled) return;
      attachmentsHydratedRef.current = true;

      if (changed) {
        setProducts(nextProducts);
        setLoadedExistingAttachmentsByIndex(
          nextProducts.map((p) =>
            (p.inspectionCertificates || []).filter((item) => !(item instanceof File)) as CertificateAttachment[]
          )
        );
      }
    };

    void hydrateAttachmentUrls();

    return () => {
      cancelled = true;
    };
  }, [certificateId, loadingCertificate, products]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    // certificateNo는 수정 불가 (시스템 자동 생성)
    if (name === 'certificateNo') {
      return;
    }
    // 입력 중에는 변환하지 않고 그대로 저장 (CSS로 대문자 표시)
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleFormBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    // customer, poNo는 포커스를 잃을 때 대문자로 변환
    const uppercaseFields = ['customer', 'poNo'];
    if (uppercaseFields.includes(name)) {
      setFormData(prev => ({
        ...prev,
        [name]: value.toUpperCase(),
      }));
    }
  };

  // 매핑 목록 로드
  useEffect(() => {
    const loadMappings = async () => {
      try {
        const mappings = await getAllProductMappings();
        setAllMappings(mappings);
      } catch (error) {
        console.error('매핑 목록 로드 오류:', error);
      }
    };
    loadMappings();
  }, []);

  // 제품명(DESCRIPTION) 포커스 아웃 시 매핑 조회 및 자동 변환 (성적서요청 등록과 동일)
  const handleProductNameBlur = async (index: number) => {
    const product = products[index];
    const productNameCode = product.productName.trim().toUpperCase();
    if (!productNameCode) return;
    try {
      const mapping = await getProductMappingByCode(productNameCode);
      if (mapping) {
        setProducts(prev => {
          const newProducts = [...prev];
          const current = newProducts[index];
          newProducts[index] = {
            ...current,
            productName: mapping.productName,
            productCode: mapping.productCode,
            inspectionCertificates: current.inspectionCertificates || [],
          };
          return newProducts;
        });
      } else {
        // 매핑이 없으면 모달 표시 (성적서요청 등록과 동일)
        setCurrentProductIndex(index);
        setCurrentProductCode(productNameCode);
        setShowMappingModal(true);
      }
    } catch (error) {
      console.error('제품명코드 매핑 조회 오류:', error);
    }
  };

  // 매핑 추가 핸들러 (모달에서 저장 시 현재 제품에 적용)
  const handleAddMapping = async (productCode: string, productName: string) => {
    try {
      await addProductMapping(productCode, productName);
      const mappings = await getAllProductMappings();
      setAllMappings(mappings);
      if (currentProductIndex !== null) {
        setProducts(prev => {
          const newProducts = [...prev];
          newProducts[currentProductIndex] = {
            ...newProducts[currentProductIndex],
            productName,
            productCode: newProducts[currentProductIndex].productCode.trim() || productCode,
            inspectionCertificates: newProducts[currentProductIndex].inspectionCertificates || [],
          };
          return newProducts;
        });
      }
      setShowMappingModal(false);
      setCurrentProductIndex(null);
      setCurrentProductCode('');
    } catch (error: unknown) {
      console.error('매핑 추가 오류:', error);
      const message = error instanceof Error ? error.message : '매핑 추가에 실패했습니다.';
      alert(message);
    }
  };

  const handleUpdateMapping = async (id: string, productName: string) => {
    try {
      await updateProductMapping(id, productName);
      const mappings = await getAllProductMappings();
      setAllMappings(mappings);
      setEditingMapping(null);
    } catch (error) {
      console.error('매핑 수정 오류:', error);
      alert('매핑 수정에 실패했습니다.');
    }
  };

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('이 매핑을 삭제하시겠습니까?')) return;
    try {
      await deleteProductMapping(id);
      const mappings = await getAllProductMappings();
      setAllMappings(mappings);
    } catch (error) {
      console.error('매핑 삭제 오류:', error);
      alert('매핑 삭제에 실패했습니다.');
    }
  };

  // 제품 필드 변경 핸들러
  const handleProductChange = (index: number, field: 'productName' | 'productCode' | 'quantity' | 'heatNo' | 'material' | 'remark', value: string) => {
    // 입력 중에는 변환하지 않고 그대로 저장 (CSS로 대문자 표시)
    setProducts(prev => {
      const newProducts = [...prev];
      const currentProduct = newProducts[index];
      newProducts[index] = {
        ...currentProduct,
        [field]: value,
        // inspectionCertificates를 명시적으로 유지
        inspectionCertificates: currentProduct.inspectionCertificates || [],
      };
      return newProducts;
    });
  };

  // 제품 필드 포커스 아웃 핸들러 (대문자 변환)
  const handleProductBlur = (index: number, field: 'productName' | 'productCode' | 'heatNo' | 'material' | 'remark', value: string) => {
    const uppercaseFields = ['productName', 'productCode', 'heatNo', 'material', 'remark'];
    if (uppercaseFields.includes(field)) {
      setProducts(prev => {
        const newProducts = [...prev];
        const currentProduct = newProducts[index];
        newProducts[index] = {
          ...currentProduct,
          [field]: value.toUpperCase(),
          inspectionCertificates: currentProduct.inspectionCertificates || [],
        };
        return newProducts;
      });
    }
  };

  // 제품 추가 (이전 제품 내용 복사)
  const handleAddProduct = () => {
    setProducts(prev => {
      const lastProduct = prev[prev.length - 1];
      // 마지막 제품의 내용을 복사하되, Inspection Certi 파일은 복사하지 않음
      const newProduct = {
        productName: lastProduct?.productName || '',
        productCode: lastProduct?.productCode || '',
        quantity: lastProduct?.quantity || '',
        heatNo: lastProduct?.heatNo || '',
        material: lastProduct?.material || '',
        remark: lastProduct?.remark || '',
        inspectionCertificates: [], // 파일은 복사하지 않음
      };
      return [...prev, newProduct];
    });
    setLoadedExistingAttachmentsByIndex((prev) => [...prev, []]);
  };

  // 제품 삭제 (Storage에서 파일도 삭제)
  const handleRemoveProduct = async (index: number) => {
    if (products.length <= 1) {
      alert('최소 1개의 제품이 필요합니다.');
      return;
    }

    const productToRemove = products[index];
    const filesToDelete: string[] = []; // 삭제할 파일의 storagePath 목록

    // 삭제될 제품의 Inspection Certificate 파일들 확인
    if (productToRemove.inspectionCertificates && productToRemove.inspectionCertificates.length > 0) {
      for (const item of productToRemove.inspectionCertificates) {
        // File 객체는 아직 업로드되지 않았으므로 삭제할 필요 없음
        // CertificateAttachment 타입이고 storagePath가 있으면 삭제 대상
        if (!(item instanceof File)) {
          const cert = item as CertificateAttachment;
          if (cert.storagePath && cert.storagePath.trim().length > 0) {
            filesToDelete.push(cert.storagePath);
          }
        }
      }
    }

    // 확인 메시지
    const productName = productToRemove.productName || `제품 ${index + 1}`;
    const fileCount = filesToDelete.length;
    const confirmMessage = fileCount > 0
      ? `${productName}을(를) 삭제하시겠습니까?\n연결된 Inspection Certificate 파일 ${fileCount}개도 Storage에서 삭제됩니다.`
      : `${productName}을(를) 삭제하시겠습니까?`;

    if (!confirm(confirmMessage)) {
      return;
    }

    // Firebase Storage에서 파일 삭제
    if (filesToDelete.length > 0) {
      try {
        console.log(`[제품 삭제] 제품 ${index + 1} "${productName}"의 파일 ${filesToDelete.length}개 삭제 시작`);
        for (const storagePath of filesToDelete) {
          try {
            const fileRef = ref(storage, storagePath);
            await deleteObject(fileRef);
            console.log(`[제품 삭제] ✅ 파일 삭제 완료: ${storagePath}`);
          } catch (deleteError) {
            // 개별 파일 삭제 실패해도 계속 진행 (파일이 이미 없을 수 있음)
            console.warn(`[제품 삭제] ⚠️ 파일 삭제 실패 (계속 진행): ${storagePath}`, deleteError);
          }
        }
        console.log(`[제품 삭제] ✅ 제품 ${index + 1} "${productName}"의 모든 파일 삭제 완료`);
      } catch (error) {
        console.error(`[제품 삭제] ❌ 파일 삭제 중 오류:`, error);
        // 파일 삭제 실패해도 제품은 삭제 (사용자에게 알림)
        alert('일부 파일 삭제에 실패했지만 제품은 삭제되었습니다.');
      }
    }

    // UI에서 제품 제거
    setProducts(prev => prev.filter((_, i) => i !== index));
    setLoadedExistingAttachmentsByIndex((prev) => prev.filter((_, i) => i !== index));
    setTouchedAttachmentProductIndexes((prev) => {
      const next = new Set<number>();
      prev.forEach((touchedIndex) => {
        if (touchedIndex < index) next.add(touchedIndex);
        if (touchedIndex > index) next.add(touchedIndex - 1);
      });
      return next;
    });
    console.log(`[제품 삭제] ✅ 제품 ${index + 1} "${productName}" 삭제 완료`);
  };


  // 제품별 Inspection Certi 파일 추가 (파일 구분 제거)
  const handleProductInspectionCertiAdd = (index: number, files: FileList | null) => {
    if (!files || files.length === 0) {
      console.log('[파일 추가] 파일이 없습니다.');
      return;
    }
    
    console.log('[파일 추가] 파일 선택됨:', Array.from(files).map(f => f.name));
    setTouchedAttachmentProductIndexes((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    
    setProducts(prev => {
      const newProducts = prev.map((p) => ({ ...p })); // 깊은 복사
      const newFiles = Array.from(files);
      
      if (!newProducts[index]) {
        console.error('[파일 추가] 제품 인덱스가 유효하지 않습니다:', index);
        return prev;
      }
      
      const currentProduct = newProducts[index];
      
      // 모든 파일을 하나의 배열로 통합
      const currentFiles = currentProduct.inspectionCertificates || [];
      console.log('[파일 추가] 현재 제품의 파일:', currentFiles.map(f => f instanceof File ? f.name : f.name));
      console.log('[파일 추가] 새로 선택한 파일:', newFiles.map(f => f.name));
      
      // 새로 선택한 파일 추가 (File 객체로 추가)
      const updatedFiles = [...currentFiles, ...newFiles];
      // Material과 Heat No.는 모든 파일에서 수집
      const { material, heatNo } = collectMaterialAndHeatNo(updatedFiles);
      
      // 한 번에 모든 업데이트 적용
      const updatedProduct = {
        ...currentProduct,
        inspectionCertificates: updatedFiles,
        material,
        heatNo,
      };
      
      console.log('[파일 추가] 업데이트된 제품의 파일:', updatedProduct.inspectionCertificates.map(f => f instanceof File ? f.name : f.name));
      console.log('[파일 추가] Material:', material, 'Heat No.:', heatNo);
      
      newProducts[index] = updatedProduct;
      
      console.log('[파일 추가] 상태 업데이트 완료, 반환할 제품 수:', newProducts.length);
      console.log('[파일 추가] 업데이트된 제품의 파일 수:', newProducts[index].inspectionCertificates.length);
      
      return newProducts;
    });
  };

  const handleDeleteInspectionCerti = (productIndex: number, fileIndex: number) => {
    const currentProduct = products[productIndex];
    const currentFiles = currentProduct?.inspectionCertificates || [];
    const fileToDelete = currentFiles[fileIndex];
    if (!fileToDelete) return;

    const fileName = fileToDelete instanceof File ? fileToDelete.name : fileToDelete.name;
    if (!confirm(`"${fileName}" 파일을 삭제하시겠습니까?`)) return;

    if (!(fileToDelete instanceof File)) {
      const cert = fileToDelete as CertificateAttachment;
      const removeKey = cert.storagePath?.trim()
        ? `sp:${cert.storagePath.trim()}`
        : `nu:${cert.name || ''}::${cert.url || ''}`;
      setRemovedAttachmentKeys((prev) => {
        const next = new Set(prev);
        next.add(removeKey);
        return next;
      });
      setLoadedExistingAttachmentsByIndex((prev) =>
        prev.map((files, idx) =>
          idx !== productIndex
            ? files
            : files.filter((f) => {
                const key = f.storagePath?.trim()
                  ? `sp:${f.storagePath.trim()}`
                  : `nu:${f.name || ''}::${f.url || ''}`;
                return key !== removeKey;
              })
        )
      );
    }

    setTouchedAttachmentProductIndexes((prev) => {
      const next = new Set(prev);
      next.add(productIndex);
      return next;
    });

    setProducts((prev) => {
      const next = [...prev];
      const product = next[productIndex];
      const updatedFiles = (product.inspectionCertificates || []).filter((_, i) => i !== fileIndex);
      const { material, heatNo } = collectMaterialAndHeatNo(updatedFiles);
      next[productIndex] = {
        ...product,
        inspectionCertificates: updatedFiles,
        material,
        heatNo,
      };
      return next;
    });
  };


  const validateForm = () => {
    const errors: typeof formErrors = {};
    let hasError = false;

    // 기본 정보 검증
    if (!formData.certificateNo.trim()) {
      errors.certificateNo = 'CERTIFICATE NO.를 입력해주세요.';
      hasError = true;
    }
    if (!formData.dateOfIssue.trim()) {
      errors.dateOfIssue = 'DATE OF ISSUE를 선택해주세요.';
      hasError = true;
    }
    if (!formData.customer.trim()) {
      errors.customer = 'CUSTOMER를 입력해주세요.';
      hasError = true;
    }
    
    // 제품 검증 (최소 1개 제품은 필수)
    const validProducts = products.filter(p => p.productName.trim() || p.productCode.trim() || p.quantity.trim());
    if (validProducts.length === 0) {
      setError('최소 1개 이상의 제품을 입력해주세요.');
      setFormErrors(errors);
      return false;
    }
    
    // 각 제품의 필수 필드 검증
    const productErrors: Array<{ productName?: string; productCode?: string; quantity?: string }> = [];
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const productError: { productName?: string; productCode?: string; quantity?: string } = {};
      
      // 제품이 비어있지 않은 경우에만 검증
      if (product.productName.trim() || product.productCode.trim() || product.quantity.trim()) {
        if (!product.productName.trim()) {
          productError.productName = '제품명을 입력해주세요.';
          hasError = true;
        }
        if (!product.productCode.trim()) {
          productError.productCode = 'CODE를 입력해주세요.';
          hasError = true;
        }
        if (!product.quantity.trim()) {
          productError.quantity = '수량을 입력해주세요.';
          hasError = true;
        }
      }
      
      productErrors.push(productError);
    }
    
    if (productErrors.length > 0) {
      errors.products = productErrors;
    }
    
    setFormErrors(errors);
    
    if (hasError) {
      // 첫 번째 에러 필드로 스크롤
      setTimeout(() => {
        if (errors.certificateNo) {
          const element = document.getElementById('certificateNo');
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            (element as HTMLInputElement).focus();
          }
        } else if (errors.dateOfIssue) {
          const element = document.getElementById('dateOfIssue');
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            (element as HTMLInputElement).focus();
          }
        } else if (errors.customer) {
          const element = document.getElementById('customer');
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            (element as HTMLInputElement).focus();
          }
        } else if (errors.products) {
          // 첫 번째 제품 에러 필드로 스크롤
          for (let i = 0; i < errors.products.length; i++) {
            const productError = errors.products[i];
            if (productError.productName) {
              const element = document.getElementById(`productName-${i}`);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                (element as HTMLInputElement).focus();
                break;
              }
            } else if (productError.productCode) {
              const element = document.getElementById(`productCode-${i}`);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                (element as HTMLInputElement).focus();
                break;
              }
            } else if (productError.quantity) {
              const element = document.getElementById(`quantity-${i}`);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                (element as HTMLInputElement).focus();
                break;
              }
            }
          }
        }
      }, 100);
      return false;
    }
    
    return true;
  };

  const loadCertificateForEdit = async (targetCertificateId: string): Promise<{
    createdAt: Date;
    createdBy: string;
    existingCertificateFileStoragePath: string | null;
    existingProductsFromFirestore: CertificateProduct[];
    existingRootAttachments: CertificateAttachment[];
  }> => {
    let createdAt = new Date();
    let createdBy = 'admin';
    let existingCertificateFileStoragePath: string | null = null;
    let existingProductsFromFirestore: CertificateProduct[] = [];
    let existingRootAttachments: CertificateAttachment[] = [];

    const existingDoc = await getDoc(doc(db, 'certificates', targetCertificateId));
    if (existingDoc.exists()) {
      const existingData = existingDoc.data();
      if (existingData.materialTestCertificate) {
        createdAt = existingData.materialTestCertificate.createdAt?.toDate() || new Date();
        createdBy = existingData.materialTestCertificate.createdBy || 'admin';
        if (existingData.materialTestCertificate.products && Array.isArray(existingData.materialTestCertificate.products)) {
          existingProductsFromFirestore = existingData.materialTestCertificate.products;
        }
      }
      if (Array.isArray(existingData.attachments)) {
        existingRootAttachments = existingData.attachments.map((raw: unknown) => {
          const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
          const uploadedAtCandidate = record.uploadedAt;
          return {
            name: typeof record.name === 'string' ? record.name : '',
            url: typeof record.url === 'string' ? record.url : '',
            storagePath: typeof record.storagePath === 'string' ? record.storagePath : undefined,
            size: typeof record.size === 'number' ? record.size : 0,
            type: typeof record.type === 'string' ? record.type : '',
            uploadedAt:
              uploadedAtCandidate && typeof uploadedAtCandidate === 'object' && 'toDate' in uploadedAtCandidate
                ? (uploadedAtCandidate as { toDate: () => Date }).toDate()
                : (uploadedAtCandidate instanceof Date ? uploadedAtCandidate : new Date()),
            uploadedBy: typeof record.uploadedBy === 'string' ? record.uploadedBy : 'admin',
          } as CertificateAttachment;
        });
      }
      if (existingData.certificateFile && existingData.certificateFile.storagePath) {
        existingCertificateFileStoragePath = existingData.certificateFile.storagePath;
      }
    }

    return {
      createdAt,
      createdBy,
      existingCertificateFileStoragePath,
      existingProductsFromFirestore,
      existingRootAttachments,
    };
  };

  const generateCertificatePdf = async (
    targetFormData: {
      certificateNo: string;
      dateOfIssue: string;
      customer: string;
      poNo: string;
      testResult: string;
    },
    productsForPdf: CertificateProduct[]
  ) =>
    Promise.race([
      generatePDFBlobWithProducts(targetFormData, productsForPdf),
      new Promise<ReturnType<typeof generatePDFBlobWithProducts> extends Promise<infer T> ? T : never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('PDF 생성 타임아웃 (120초)'));
        }, 120000);
      }),
    ]);

  const saveCertificateDocument = async (
    targetCertificateId: string,
    materialTestCertificateForFirestore: Record<string, unknown>,
    certificateFileForFirestore: Record<string, unknown>
  ) => {
    await updateDoc(doc(db, 'certificates', targetCertificateId), {
      materialTestCertificate: materialTestCertificateForFirestore,
      certificateFile: certificateFileForFirestore,
      status: 'completed',
      completedAt: Timestamp.now(),
      completedBy: 'admin',
      updatedAt: Timestamp.now(),
      updatedBy: 'admin',
    });
  };

  const handleSave = async () => {
    // 수정 모드인 경우 certificateId가 필요
    if (!certificateId) {
      setError('성적서 ID가 없습니다.');
      return;
    }

    if (!validateForm()) {
      setSaving(false);
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const currentFingerprint = buildEditFingerprint(formData, products);
      if (
        initialEditFingerprintRef.current &&
        currentFingerprint === initialEditFingerprintRef.current &&
        touchedAttachmentProductIndexes.size === 0
      ) {
        setSuccess('변경사항이 없어 기존 PDF/첨부를 그대로 유지했습니다. 목록으로 이동합니다.');
        router.push(isV2Flow ? '/admin/certificate/list2' : '/admin/certificate');
        return;
      }

      const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error('FileReader result is not a string'));
          };
          reader.onerror = () => reject(new Error('FileReader error'));
          reader.readAsDataURL(blob);
        });

      const fetchUrlAsBase64DataUrl = async (url: string): Promise<string | null> => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000);
          const res = await fetch(url, { method: 'GET', headers: { Accept: 'image/*' }, signal: controller.signal });
          clearTimeout(timeoutId);
          if (!res.ok) return null;
          const blob = await res.blob();
          return await readBlobAsDataUrl(blob);
        } catch {
          return null;
        }
      };

      const uploadNewAttachments = async (
        targetCertificateId: string,
        items: Array<CertificateAttachment | File>,
        productIndex: number
      ): Promise<CertificateAttachment[]> => {
        const uploaded: CertificateAttachment[] = [];
        for (const item of items) {
          if (!(item instanceof File)) continue;
          try {
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(2, 15);
            const fileName = `inspection_certi_${targetCertificateId || 'temp'}_${timestamp}_${randomId}_${item.name}`;
            const filePath = `certificates/${targetCertificateId || 'temp'}/inspection_certi/${fileName}`;

            const storageRef = ref(storage, filePath);
            await uploadBytes(storageRef, item);
            const downloadURL = await getDownloadURL(storageRef);

            const base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                if (typeof reader.result === 'string') resolve(reader.result);
                else reject(new Error('FileReader result is not a string'));
              };
              reader.onerror = () => reject(new Error('FileReader error'));
              reader.readAsDataURL(item);
            });

            uploaded.push({
              name: item.name,
              url: downloadURL,
              storagePath: filePath,
              size: item.size,
              type: item.type,
              uploadedAt: new Date(),
              uploadedBy: 'admin',
              base64: base64Data,
            });
            console.log(`[저장] 제품 ${productIndex + 1} 새 파일 "${item.name}" 업로드 및 base64 변환 완료`);
          } catch (fileError) {
            throw new Error(
              `파일 "${item.name}" 업로드에 실패했습니다: ${
                fileError instanceof Error ? fileError.message : String(fileError)
              }`
            );
          }
        }
        return uploaded;
      };

      // Step 1) 기존 성적서 메타 로드
      const {
        createdAt,
        createdBy,
        existingCertificateFileStoragePath,
        existingProductsFromFirestore,
        existingRootAttachments,
      } = await loadCertificateForEdit(certificateId);

      // 문서 ID 기준 Storage 실파일 존재 여부 점검
      let storageAttachmentItems: Array<{ name: string; fullPath: string }> = [];
      try {
        const storageDirRef = ref(storage, `certificates/${certificateId}/inspection_certi`);
        const listed = await listAll(storageDirRef);
        storageAttachmentItems = listed.items.map((itemRef) => ({
          name: itemRef.name || '',
          fullPath: itemRef.fullPath || '',
        }));
        console.log(`[저장] Storage 실파일 점검: certificates/${certificateId}/inspection_certi -> ${storageAttachmentItems.length}개`);
      } catch (storageInspectError) {
        console.warn('[저장] Storage 실파일 점검 실패:', storageInspectError);
      }

      const loadedAttachmentCount = loadedExistingAttachmentsByIndex.reduce(
        (sum, certs) => sum + (certs?.length || 0),
        0
      );
      if (loadedAttachmentCount > 0 && storageAttachmentItems.length === 0) {
        setError(
          `Storage 실파일 점검 결과 첨부 폴더가 비어 있습니다.\n` +
          `경로: certificates/${certificateId}/inspection_certi\n` +
          `현재 문서는 첨부 메타(${loadedAttachmentCount}개)만 있고 실파일이 없어 PDF 통합이 불가능합니다.\n` +
          `파일 재첨부 후 저장하거나 Storage 경로를 확인해주세요.`
        );
        setSaving(false);
        return;
      }
      
      // 제품별 Inspection Certi 업로드 및 제품 데이터 준비
      const productsData: CertificateProduct[] = [];
      const productsDataForFirestore: CertificateProduct[] = []; // Firestore 저장용 (기존 + 새 파일)

      const toNormalizedAttachment = (raw: unknown): CertificateAttachment | null => {
        if (!raw || typeof raw !== 'object') return null;
        const record = raw as Record<string, unknown>;
        const uploadedAtCandidate = record.uploadedAt;
        return {
          name: typeof record.name === 'string' ? record.name : '',
          url: typeof record.url === 'string' ? record.url : '',
          storagePath: typeof record.storagePath === 'string' ? record.storagePath : undefined,
          size: typeof record.size === 'number' ? record.size : 0,
          type: typeof record.type === 'string' ? record.type : '',
          uploadedAt:
            uploadedAtCandidate && typeof uploadedAtCandidate === 'object' && 'toDate' in uploadedAtCandidate
              ? (uploadedAtCandidate as { toDate: () => Date }).toDate()
              : (uploadedAtCandidate instanceof Date ? uploadedAtCandidate : new Date()),
          uploadedBy: typeof record.uploadedBy === 'string' ? record.uploadedBy : 'admin',
        };
      };

      const extractCertsFromProduct = (rawProduct: unknown): CertificateAttachment[] => {
        if (!rawProduct || typeof rawProduct !== 'object') return [];
        const productRecord = rawProduct as Record<string, unknown>;
        const fromArray = Array.isArray(productRecord.inspectionCertificates)
          ? productRecord.inspectionCertificates.map(toNormalizedAttachment).filter(Boolean) as CertificateAttachment[]
          : [];
        if (fromArray.length > 0) return fromArray;
        const fromSingle = toNormalizedAttachment(productRecord.inspectionCertificate);
        return fromSingle ? [fromSingle] : [];
      };

      const getExistingProductAttachmentsFallback = (
        currentProduct: {
          productName: string;
          productCode: string;
        },
        productIndex: number
      ): CertificateAttachment[] => {
        const allExistingProducts = [...(existingProductsFromFirestore || [])];
        if (allExistingProducts.length === 0) return [];

        const byNameCode = allExistingProducts.find((ep) => {
          const epName = String(ep?.productName || '').trim();
          const epCode = String(ep?.productCode || '').trim();
          return (
            epName.length > 0 &&
            epName === currentProduct.productName.trim() &&
            (epCode === currentProduct.productCode.trim() || currentProduct.productCode.trim().length === 0)
          );
        });

        const fallbackProduct =
          byNameCode ||
          existingProductsFromFirestore[productIndex] ||
          null;
        if (!fallbackProduct) return [];

        return extractCertsFromProduct(fallbackProduct);
      };

      const getAttachmentKey = (cert: CertificateAttachment): string =>
        cert.storagePath && cert.storagePath.trim().length > 0
          ? `sp:${cert.storagePath.trim()}`
          : `nu:${cert.name || ''}::${cert.url || ''}`;

      const findRootAttachmentFallback = (name: string): CertificateAttachment | null => {
        const target = (name || '').trim().toLowerCase();
        if (!target) return null;
        const matched = (existingRootAttachments || []).find((item) => {
          const itemName = (item.name || '').trim().toLowerCase();
          return itemName === target || itemName.includes(target) || target.includes(itemName);
        });
        return matched ? { ...matched } : null;
      };
      
      console.log(`[저장] 시작 - 총 ${products.length}개 제품 처리 예정`);
      
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        
        // 디버깅: 각 제품의 초기 상태 확인
        console.log(`[저장] 제품 ${i + 1} "${product.productName}" 처리 시작:`, {
          totalFiles: product.inspectionCertificates?.length || 0,
          files: product.inspectionCertificates?.map((item, idx) => ({
            index: idx + 1,
            name: item instanceof File ? item.name : item.name,
            isFile: item instanceof File,
            url: item instanceof File ? null : item.url,
            hasUrl: item instanceof File ? false : !!item.url && item.url.trim().length > 0,
            storagePath: item instanceof File ? null : item.storagePath,
          })) || [],
        });
        
        const hasAnyInspectionFile = (product.inspectionCertificates?.length || 0) > 0;
        if (
          !product.productName.trim() &&
          !product.productCode.trim() &&
          !product.quantity.trim() &&
          !hasAnyInspectionFile
        ) {
          console.log(`[저장] 제품 ${i + 1} 빈 제품(파일 없음)으로 제외됨`);
          continue; // 빈 제품은 제외
        }

        // Inspection Certi 파일 처리 (생성 페이지와 동일한 방식)
        const inspectionCertificates: CertificateAttachment[] = [];
        const wasAttachmentTouched = touchedAttachmentProductIndexes.has(i);
        if (!wasAttachmentTouched) {
          // 핵심 규칙(강제):
          // 첨부를 건드리지 않은 제품은 기존 첨부 원본만 사용
          // - loadedExistingAttachmentsByIndex 우선
          // - 없으면 Firestore fallback
          const currentStateCerts = (product.inspectionCertificates || []).filter(
            (item): item is CertificateAttachment => !(item instanceof File)
          );
          const preservedLoadedCerts = loadedExistingAttachmentsByIndex[i] || [];
          const sourceCerts =
            currentStateCerts.length > 0
              ? currentStateCerts
              : preservedLoadedCerts.length > 0
                ? preservedLoadedCerts
              : getExistingProductAttachmentsFallback(
                  { productName: product.productName, productCode: product.productCode },
                  i
                );
          for (const cert of sourceCerts) {
            const key = getAttachmentKey(cert);
            if (!removedAttachmentKeys.has(key)) {
              const nextCert: CertificateAttachment = { ...cert };
              let finalUrl = nextCert.url || '';

              // 미수정 분기에서도 storagePath 기반 URL을 재동기화해 토큰 만료 이슈를 방지
              if (nextCert.storagePath && nextCert.storagePath.trim().length > 0) {
                try {
                  const storageRef = ref(storage, nextCert.storagePath);
                  const refreshedUrl = await getDownloadURL(storageRef);
                  if (refreshedUrl && refreshedUrl.trim().length > 0) {
                    finalUrl = refreshedUrl;
                    nextCert.url = refreshedUrl;
                  }
                } catch (error) {
                  console.warn(`[저장] 제품 ${i + 1} 미수정 파일 URL 재동기화 실패:`, nextCert.name, error);
                }
              }

              // 미수정 분기에서도 링크 메타가 비어 있으면 파일명 기준으로 복구 시도
              // (수정 페이지 진입 직후 저장 시 PNG 누락 방지)
              if (
                (!finalUrl || finalUrl.trim().length === 0) &&
                (!nextCert.storagePath || nextCert.storagePath.trim().length === 0)
              ) {
                const rootFallback = findRootAttachmentFallback(nextCert.name || '');
                if (rootFallback) {
                  nextCert.url = nextCert.url || rootFallback.url || '';
                  nextCert.storagePath = nextCert.storagePath || rootFallback.storagePath || undefined;
                  nextCert.type = nextCert.type || rootFallback.type || '';
                  nextCert.size = nextCert.size || rootFallback.size || 0;
                  finalUrl = nextCert.url || '';
                }
              }

              if (
                (!finalUrl || finalUrl.trim().length === 0) &&
                (!nextCert.storagePath || nextCert.storagePath.trim().length === 0)
              ) {
                try {
                  if (certificateId && nextCert.name) {
                    const dirRef = ref(storage, `certificates/${certificateId}/inspection_certi`);
                    const listed = await listAll(dirRef);
                    const matched = listed.items.find((itemRef) => {
                      const fileNameInStorage = itemRef.name || '';
                      return fileNameInStorage.includes(nextCert.name || '');
                    });
                    if (matched) {
                      const recoveredUrl = await getDownloadURL(matched);
                      nextCert.storagePath = matched.fullPath;
                      nextCert.url = recoveredUrl;
                      finalUrl = recoveredUrl;
                      console.log(
                        `[저장] 제품 ${i + 1} 미수정 파일 "${nextCert.name}" 링크 복구 성공: ${matched.fullPath}`
                      );
                    }
                  }
                } catch (recoverError) {
                  console.warn(`[저장] 제품 ${i + 1} 미수정 파일 링크 복구 시도 실패:`, nextCert.name, recoverError);
                }
              }

              // URL이 있고 base64가 비어 있으면 보강 (PDF 렌더 안정성)
              if (
                (!nextCert.base64 || nextCert.base64.trim().length === 0) &&
                finalUrl &&
                finalUrl.trim().length > 0
              ) {
                const base64DataUrl = await fetchUrlAsBase64DataUrl(finalUrl);
                if (base64DataUrl) {
                  nextCert.base64 = base64DataUrl;
                }
              }

              inspectionCertificates.push(nextCert);
            }
          }
        } else if (product.inspectionCertificates && product.inspectionCertificates.length > 0) {
          // 첨부를 건드린 제품만 현재 UI 파일 상태(File/Attachment)를 반영
          for (const item of product.inspectionCertificates) {
            if (!(item instanceof File)) {
              // 기존 CertificateAttachment 처리
              const cert = item as CertificateAttachment;
              if (cert) {
                let finalUrl = cert.url || '';
                
                // storagePath가 있으면 URL이 있어도 항상 최신 downloadURL로 갱신
                // (기존 토큰 만료/변경으로 PDF 생성 시 누락되는 문제 방지)
                if (cert.storagePath && cert.storagePath.trim().length > 0) {
                  try {
                    console.log(`[저장] 제품 ${i + 1} 기존 파일 "${cert.name}" storagePath로 URL 갱신 시도:`, cert.storagePath);
                    const storageRef = ref(storage, cert.storagePath);
                    const refreshedUrl = await getDownloadURL(storageRef);
                    finalUrl = refreshedUrl;
                    console.log(`[저장] 제품 ${i + 1} 기존 파일 "${cert.name}" URL 갱신 성공`);
                    // URL을 업데이트
                    cert.url = finalUrl;
                  } catch (urlError) {
                    const code =
                      typeof urlError === 'object' && urlError !== null && 'code' in urlError
                        ? String((urlError as { code?: unknown }).code)
                        : undefined;
                    if (code === 'storage/object-not-found') {
                      console.warn(
                        `[저장] 제품 ${i + 1} 기존 파일 "${cert.name}" storagePath 파일이 없어 URL 갱신 생략:`,
                        cert.storagePath
                      );
                    } else {
                      console.warn(`[저장] 제품 ${i + 1} 기존 파일 "${cert.name}" URL 갱신 실패:`, urlError);
                    }
                    // 갱신 실패 시 기존 URL 유지 (있으면 사용), 없으면 복구/보존 분기로 계속 진행
                  }
                }
                
                // 모든 기존 파일 추가 (URL이 없어도 storagePath가 있으면 포함)
                // URL과 storagePath가 모두 없으면 제외
                if (finalUrl && finalUrl.trim().length > 0) {
                  const base64DataUrl = cert.base64 || (await fetchUrlAsBase64DataUrl(finalUrl)) || undefined;
                  inspectionCertificates.push({
                    ...cert,
                    url: finalUrl, // 업데이트된 URL 사용
                    base64: base64DataUrl,
                  });
                  console.log(`[저장] 제품 ${i + 1} 기존 파일 "${cert.name}" 추가 (URL: 있음), 현재 총 ${inspectionCertificates.length}개`);
                } else if (cert.storagePath && cert.storagePath.trim().length > 0) {
                  // URL이 없어도 storagePath가 있으면 추가 (PDF 생성 시 다시 시도)
                  inspectionCertificates.push({
                    ...cert,
                    url: finalUrl || '', // 빈 문자열이라도 URL 필드 유지
                  });
                  console.log(`[저장] 제품 ${i + 1} 기존 파일 "${cert.name}" 추가 (URL: 없음, storagePath: 있음), 현재 총 ${inspectionCertificates.length}개`);
                } else {
                  const rootFallback = findRootAttachmentFallback(cert.name || '');
                  if (rootFallback) {
                    const rootUrl = rootFallback.url || '';
                    const rootStoragePath = rootFallback.storagePath || undefined;
                    const rootBase64 = rootUrl ? (await fetchUrlAsBase64DataUrl(rootUrl)) || undefined : undefined;
                    inspectionCertificates.push({
                      ...cert,
                      url: rootUrl,
                      storagePath: rootStoragePath,
                      type: cert.type || rootFallback.type || '',
                      size: cert.size || rootFallback.size || 0,
                      base64: cert.base64 || rootBase64,
                    });
                    console.log(`[저장] 제품 ${i + 1} 기존 파일 "${cert.name}" 루트 첨부 fallback 복구 적용`);
                    continue;
                  }

                  // 링크 정보가 비어있는 기존 첨부 복구 시도:
                  // certificates/{certificateId}/inspection_certi 폴더에서 파일명을 기준으로 찾아 URL/경로를 보강
                  let recovered = false;
                  try {
                    if (certificateId && cert.name) {
                      const dirRef = ref(storage, `certificates/${certificateId}/inspection_certi`);
                      const listed = await listAll(dirRef);
                      const matched = listed.items.find((itemRef) => {
                        const fileNameInStorage = itemRef.name || '';
                        return fileNameInStorage.includes(cert.name);
                      });
                      if (matched) {
                        const recoveredUrl = await getDownloadURL(matched);
                        inspectionCertificates.push({
                          ...cert,
                          url: recoveredUrl,
                          storagePath: matched.fullPath,
                        });
                        recovered = true;
                        console.log(
                          `[저장] 제품 ${i + 1} 기존 파일 "${cert.name}" 링크 복구 성공: ${matched.fullPath}`
                        );
                      }
                    }
                  } catch (recoverError) {
                    console.warn(`[저장] 기존 파일 링크 복구 시도 실패: "${cert.name}"`, recoverError);
                  }

                  if (!recovered) {
                    // 링크를 복구하지 못해도 메타는 보존 (저장 누락 방지)
                    inspectionCertificates.push({
                      ...cert,
                      url: '',
                      storagePath: cert.storagePath || undefined,
                    });
                    console.warn(
                      `[저장] ⚠️ 제품 ${i + 1} 기존 파일 "${cert.name}" URL/storagePath 복구 실패, 메타만 보존`
                    );
                  }
                }
              }
            }
          }
        }

        // 미수정 제품에서 예상치 못한 빈 첨부가 나오면 마지막으로 한 번 더 복원
        if (!wasAttachmentTouched && inspectionCertificates.length === 0) {
          const fallbackCerts = getExistingProductAttachmentsFallback(
            { productName: product.productName, productCode: product.productCode },
            i
          );
          if (fallbackCerts.length > 0) {
            inspectionCertificates.push(...fallbackCerts.map((c) => ({ ...c })));
          }
        }

        // 최후 복구:
        // 과거 버그로 Firestore 첨부 메타가 비어있는 문서는
        // certificates/{certificateId}/inspection_certi 폴더를 직접 조회해 첨부를 재구성한다.
        if (!wasAttachmentTouched && inspectionCertificates.length === 0 && certificateId) {
          try {
            const dirRef = ref(storage, `certificates/${certificateId}/inspection_certi`);
            const listed = await listAll(dirRef);
            if (listed.items.length > 0) {
              const recoveredFromStorage: CertificateAttachment[] = [];
              for (const itemRef of listed.items) {
                try {
                  const downloadUrl = await getDownloadURL(itemRef);
                  const lowerName = (itemRef.name || '').toLowerCase();
                  let inferredType = '';
                  if (lowerName.endsWith('.png')) inferredType = 'image/png';
                  else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) inferredType = 'image/jpeg';
                  else if (lowerName.endsWith('.webp')) inferredType = 'image/webp';
                  else if (lowerName.endsWith('.gif')) inferredType = 'image/gif';
                  else if (lowerName.endsWith('.pdf')) inferredType = 'application/pdf';

                  recoveredFromStorage.push({
                    name: itemRef.name || '',
                    url: downloadUrl,
                    storagePath: itemRef.fullPath,
                    size: 0,
                    type: inferredType,
                    uploadedAt: new Date(),
                    uploadedBy: 'admin',
                  });
                } catch (itemError) {
                  console.warn('[저장] Storage 기반 첨부 복구 실패(개별 파일 건너뜀):', itemRef.fullPath, itemError);
                }
              }
              if (recoveredFromStorage.length > 0) {
                inspectionCertificates.push(...recoveredFromStorage);
                console.log(
                  `[저장] 제품 ${i + 1} Storage 폴더 직접 복구 적용: ${recoveredFromStorage.length}개`
                );
              }
            }
          } catch (storageFallbackError) {
            console.warn('[저장] Storage 폴더 직접 복구 실패:', storageFallbackError);
          }
        }
        
        // Step 2) 새 파일 업로드
        if (product.inspectionCertificates && product.inspectionCertificates.length > 0) {
          const uploadedNewAttachments = await uploadNewAttachments(certificateId, product.inspectionCertificates, i);
          inspectionCertificates.push(...uploadedNewAttachments);
        }
        
        const uniqueInspectionCertificates = inspectionCertificates.filter((cert, idx, arr) => {
          const key = cert.storagePath && cert.storagePath.trim().length > 0
            ? `sp:${cert.storagePath.trim()}`
            : `nu:${cert.name || ''}::${cert.url || ''}`;
          return arr.findIndex((x) => {
            const xKey = x.storagePath && x.storagePath.trim().length > 0
              ? `sp:${x.storagePath.trim()}`
              : `nu:${x.name || ''}::${x.url || ''}`;
            return xKey === key;
          }) === idx;
        });
        inspectionCertificates.length = 0;
        inspectionCertificates.push(...uniqueInspectionCertificates);

        console.log(`[저장] 제품 ${i + 1} 최종 파일 개수: ${inspectionCertificates.length}개 (기존 + 새 파일 모두 포함)`);
        console.log(`[저장] 제품 ${i + 1} 파일 목록:`, inspectionCertificates.map((f, idx) => `${idx + 1}. ${f.name} (URL: ${f.url ? '있음' : '없음'})`).join(', '));
        
        // 저장 시점에 모든 파일에서 Material과 Heat No.를 추출하여 설정 (생성 페이지와 동일)
        const { material: collectedMaterial, heatNo: collectedHeatNo } = collectMaterialAndHeatNo(inspectionCertificates);
        console.log(`[저장] 제품 ${i + 1} 모든 파일에서 추출한 Material:`, collectedMaterial, 'Heat No.:', collectedHeatNo);
        
        const productData: CertificateProduct = {
          productName: product.productName.trim(),
          productCode: product.productCode.trim() || undefined,
          quantity: product.quantity.trim() ? parseInt(product.quantity, 10) : undefined,
          heatNo: collectedHeatNo || product.heatNo.trim() || undefined, // 파일에서 추출한 값 우선 사용
          material: collectedMaterial || product.material.trim() || undefined, // 파일에서 추출한 값 우선 사용
        };

        // 비고는 값이 있을 때만 추가
        if (product.remark?.trim()) {
          productData.remark = product.remark.trim();
        }
        
        // 생성 페이지와 동일한 방식으로 inspectionCertificates 설정
        const productDataWithCerts = productData as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        // 배열을 복사하여 참조 문제 방지 (파일이 없어도 빈 배열로 설정)
        productDataWithCerts.inspectionCertificates = inspectionCertificates.length > 0 ? [...inspectionCertificates] : [];
        
        // 첫 번째 파일을 inspectionCertificate에 저장 (하위 호환성)
        if (inspectionCertificates.length > 0) {
          productData.inspectionCertificate = inspectionCertificates[0];
        } else {
          // 파일이 없으면 undefined로 설정
          productData.inspectionCertificate = undefined;
        }
        
        console.log(`[저장] 제품 ${i + 1} "${product.productName}" 파일 할당 확인:`, {
          totalFilesCount: inspectionCertificates.length,
          files: inspectionCertificates.map((f, idx) => ({ 
            index: idx + 1, 
            name: f.name, 
            url: f.url ? '있음' : '없음',
            hasBase64: !!f.base64,
            base64Length: f.base64 ? f.base64.length : 0,
            storagePath: f.storagePath,
          })),
        });
        
        // productData의 inspectionCertificates 확인
        console.log(`[저장] 제품 ${i + 1} productData.inspectionCertificates 확인:`, {
          hasInspectionCertificates: !!productDataWithCerts.inspectionCertificates,
          isArray: Array.isArray(productDataWithCerts.inspectionCertificates),
          length: productDataWithCerts.inspectionCertificates?.length || 0,
          files: productDataWithCerts.inspectionCertificates?.map((f, idx) => ({
            index: idx + 1,
            name: f.name,
            hasBase64: !!f.base64,
            hasUrl: !!f.url,
          })) || [],
        });
        
        productsData.push(productDataWithCerts);
        productsDataForFirestore.push(productDataWithCerts);
      }

      // 최종 보호 병합:
      // 기존 Firestore 제품의 첨부가 있는데 현재 저장 데이터에서 비어 있으면 기존 첨부를 복원
      // (제품 내용 수정/제품 추가 시 기존 첨부 소실 방지)
      const normalizeExistingCerts = (p: CertificateProduct): CertificateAttachment[] => {
        const withCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        if (withCerts.inspectionCertificates && Array.isArray(withCerts.inspectionCertificates)) {
          return withCerts.inspectionCertificates;
        }
        return p.inspectionCertificate ? [p.inspectionCertificate] : [];
      };

      const existingByNameCode = new Map<string, CertificateAttachment[]>();
      for (const existingProduct of existingProductsFromFirestore) {
        const key = `${(existingProduct.productName || '').trim()}::${(existingProduct.productCode || '').trim()}`;
        const certs = normalizeExistingCerts(existingProduct);
        if (certs.length > 0) existingByNameCode.set(key, certs);
      }

      for (let i = 0; i < productsDataForFirestore.length; i++) {
        const current = productsDataForFirestore[i];
        if (!current) continue;
        const currentWithCerts = current as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        const currentCerts = currentWithCerts.inspectionCertificates && Array.isArray(currentWithCerts.inspectionCertificates)
          ? currentWithCerts.inspectionCertificates
          : (current.inspectionCertificate ? [current.inspectionCertificate] : []);

        if (currentCerts.length > 0) continue;

        const key = `${(current.productName || '').trim()}::${(current.productCode || '').trim()}`;
        const fallbackCerts = existingByNameCode.get(key) || [];
        if (fallbackCerts.length > 0) {
          currentWithCerts.inspectionCertificates = fallbackCerts.map((c) => ({ ...c }));
          current.inspectionCertificate = currentWithCerts.inspectionCertificates[0];
          console.log(`[저장] 최종 보호 병합으로 기존 첨부 복원: 제품 ${i + 1}, ${fallbackCerts.length}개`);
        }
      }

      // 디버깅: 전체 productsData 확인
      const totalFiles = productsData.reduce((sum, p) => {
        const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        return sum + (pWithCerts.inspectionCertificates?.length || 0);
      }, 0);
      
      const totalFilesForFirestore = productsDataForFirestore.reduce((sum, p) => {
        const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        return sum + (pWithCerts.inspectionCertificates?.length || 0);
      }, 0);
      
      console.log(`[저장] 전체 productsData 요약:`, {
        totalProducts: productsData.length,
        totalFiles: totalFiles,
        products: productsData.map((p, idx) => {
          const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          return {
            index: idx + 1,
            productName: p.productName,
            inspectionCertificatesCount: pWithCerts.inspectionCertificates?.length || 0,
          };
        }),
      });
      
      console.log(`[저장] 전체 productsDataForFirestore 요약 (PDF 생성용):`, {
        totalProducts: productsDataForFirestore.length,
        totalFiles: totalFilesForFirestore,
        products: productsDataForFirestore.map((p, idx) => {
          const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const inspectionCerts = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
            ? pWithCerts.inspectionCertificates
            : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
          return {
            index: idx + 1,
            productName: p.productName,
            inspectionCertificatesCount: inspectionCerts.length,
            hasInspectionCertificates: !!pWithCerts.inspectionCertificates,
            isArray: Array.isArray(pWithCerts.inspectionCertificates),
            files: inspectionCerts.map((c, certIdx) => ({
              index: certIdx + 1,
              name: c.name,
              url: c.url,
              hasBase64: !!c.base64,
              storagePath: c.storagePath,
            })),
          };
        }),
      });

      // createdAt, createdBy, existingCertificateFileStoragePath, existingProductsFromFirestore는 이미 위에서 로드됨

      // PDF 생성용 및 Firestore 저장용 materialTestCertificate (기존 + 새 파일 모두 포함)
      const materialTestCertificate: MaterialTestCertificate = {
        certificateNo: formData.certificateNo.trim(),
        dateOfIssue: Timestamp.fromDate(new Date(formData.dateOfIssue)).toDate(),
        customer: formData.customer.trim(),
        poNo: formData.poNo.trim() || '',
        products: productsDataForFirestore, // 기존 + 새 파일 모두 포함
        testResult: formData.testResult.trim(),
        createdAt: createdAt,
        updatedAt: new Date(),
        createdBy: createdBy,
      };

      if (isV2Flow) {
        // v2 저장 안전장치: 모든 첨부 storagePath 접근 가능 여부 선검증
        const attachmentStoragePaths = productsDataForFirestore.flatMap((p) => {
          const withCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const certs =
            withCerts.inspectionCertificates && Array.isArray(withCerts.inspectionCertificates)
              ? withCerts.inspectionCertificates
              : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
          return certs
            .map((cert) => (typeof cert.storagePath === 'string' ? cert.storagePath.trim() : ''))
            .filter((v) => v.length > 0);
        });
        const uniqueStoragePaths = Array.from(new Set(attachmentStoragePaths));
        for (const storagePath of uniqueStoragePaths) {
          try {
            await getDownloadURL(ref(storage, storagePath));
          } catch (accessError) {
            const code =
              accessError && typeof accessError === 'object' && 'code' in accessError
                ? String((accessError as { code?: string }).code || '')
                : '';
            const message = accessError instanceof Error ? accessError.message : String(accessError);
            throw new Error(`첨부 접근 검증 실패: ${storagePath} (${code || 'no-code'} / ${message})`);
          }
        }

        const materialTestCertificateForFirestore = buildV2MaterialTestCertificateForFirestore(
          materialTestCertificate,
          productsDataForFirestore
        );

        const flattenedAttachments = productsDataForFirestore.flatMap((p) => {
          const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const certs = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
            ? pWithCerts.inspectionCertificates
            : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
          return certs;
        });
        const dedupedRootAttachments = flattenedAttachments.filter((cert, index, arr) => {
          const storagePath = cert.storagePath?.trim();
          const key = storagePath && storagePath.length > 0
            ? `sp:${storagePath}`
            : `nu:${cert.name || ''}::${cert.url || ''}`;
          return arr.findIndex((x) => {
            const xStoragePath = x.storagePath?.trim();
            const xKey = xStoragePath && xStoragePath.length > 0
              ? `sp:${xStoragePath}`
              : `nu:${x.name || ''}::${x.url || ''}`;
            return xKey === key;
          }) === index;
        });
        const rootAttachmentsForFirestore = dedupedRootAttachments.map((cert) => ({
          name: cert.name || '',
          url: cert.url || '',
          storagePath: cert.storagePath || null,
          size: typeof cert.size === 'number' ? cert.size : 0,
          type: cert.type || '',
          uploadedAt:
            cert.uploadedAt instanceof Date && !Number.isNaN(cert.uploadedAt.getTime())
              ? Timestamp.fromDate(cert.uploadedAt)
              : Timestamp.now(),
          uploadedBy: cert.uploadedBy || 'admin',
        }));

        await updateDoc(doc(db, 'certificates', certificateId), {
          materialTestCertificate: materialTestCertificateForFirestore,
          attachments: rootAttachmentsForFirestore,
          certificateFile: null,
          status: 'completed',
          completedAt: Timestamp.now(),
          completedBy: 'admin',
          updatedAt: Timestamp.now(),
          updatedBy: 'admin',
        });

        setSuccess('✅ 성적서 수정이 저장되었습니다. PDF는 다운로드 시 생성됩니다.');
        router.push('/admin/certificate/list2');
        return;
      }

      // PDF 생성은 productsData 생성 후에 수행됨 (아래에서 처리)
      let pdfBlob: Blob | null = null;
      let failedImageCount = 0;
      let totalExpectedFiles = 0;
      let renderedImageCount = 0;
      let mergedPdfCount = 0;
      let keptAttachmentCount = 0;
      // 본문만 수정한 경우(수량/비고 등)에도 기존 첨부 보존 안전장치를 항상 적용
      // 그렇지 않으면 무첨부로 재생성되어 기존 Inspection Certificate 페이지가 누락될 수 있음
      const shouldUpdateAttachments = true;
      const shouldRegeneratePdf = true;
      let certificateFile: CertificateAttachment | null = null;
      console.log(
        '[저장] PDF 재생성 여부:',
        shouldRegeneratePdf
          ? '예(본문 갱신 필수 + 첨부 변경 반영)'
          : '아니오'
      );

      // 첨부 업데이트 시 안전장치:
      // 첨부를 건드리지 않은 기존 제품의 첨부가 비어 있으면 로드시 스냅샷으로 강제 복원
      if (shouldUpdateAttachments) {
        for (let i = 0; i < productsDataForFirestore.length; i++) {
          if (touchedAttachmentProductIndexes.has(i)) continue;
          const p = productsDataForFirestore[i];
          if (!p) continue;
          const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const currentCerts = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
            ? pWithCerts.inspectionCertificates
            : [];
          const fallbackFromFirestore = getExistingProductAttachmentsFallback(
            {
              productName: p.productName || '',
              productCode: p.productCode || '',
            },
            i
          );
          const loadedSnapshot = loadedExistingAttachmentsByIndex[i] || [];
          // 핵심 원칙:
          // 미수정 제품은 저장 루프에서 이미 계산된 currentCerts를 우선 유지한다.
          // 비어 있을 때만 로드시점 스냅샷(loadedSnapshot) -> Firestore fallback 순으로 복구한다.
          const preserved = currentCerts.length > 0
            ? currentCerts
            : (loadedSnapshot.length > 0 ? loadedSnapshot : fallbackFromFirestore);
          pWithCerts.inspectionCertificates = preserved.map((cert) => ({ ...cert }));
          p.inspectionCertificate = pWithCerts.inspectionCertificates[0];
          console.log(
            `[저장] 제품 ${i + 1} 미수정 첨부 고정 적용: ${pWithCerts.inspectionCertificates.length}개`
          );
        }

        // 미수정 제품의 기존 첨부는 PDF 재생성 전에 base64를 선채움
        // (수량/텍스트 수정 시에도 기존 첨부 페이지가 누락되지 않도록 보강)
        for (let i = 0; i < productsDataForFirestore.length; i++) {
          if (touchedAttachmentProductIndexes.has(i)) continue;
          const p = productsDataForFirestore[i];
          if (!p) continue;
          const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const certs = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
            ? pWithCerts.inspectionCertificates
            : [];
          for (const cert of certs) {
            if (cert.base64 && cert.base64.trim().length > 0) continue;
            let finalUrl = cert.url || '';
            if (cert.storagePath && cert.storagePath.trim().length > 0) {
              try {
                const storageRef = ref(storage, cert.storagePath);
                finalUrl = await getDownloadURL(storageRef);
                cert.url = finalUrl;
              } catch {
                // URL/base64 fallback으로 계속 진행
              }
            }
            if (finalUrl && finalUrl.trim().length > 0) {
              const base64 = await fetchUrlAsBase64DataUrl(finalUrl);
              if (base64) cert.base64 = base64;
            }
          }
        }

        // 심플 안전장치:
        // "기존(미수정) 제품 첨부 개수"가 줄어든 상태라면 저장 자체를 중단한다.
        // (목록 데이터와 다운로드 PDF 불일치 방지)
        const expectedUntouchedExistingCount = loadedExistingAttachmentsByIndex.reduce((sum, certs, idx) => {
          if (touchedAttachmentProductIndexes.has(idx)) return sum;
          return sum + (certs?.length || 0);
        }, 0);
        const actualUntouchedExistingCount = productsDataForFirestore.reduce((sum, p, idx) => {
          if (touchedAttachmentProductIndexes.has(idx)) return sum;
          const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const certs = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
            ? pWithCerts.inspectionCertificates
            : [];
          return sum + certs.length;
        }, 0);

        if (actualUntouchedExistingCount < expectedUntouchedExistingCount) {
          console.error('[저장] 기존 제품 첨부 누락 위험 감지 - 저장 중단', {
            expectedUntouchedExistingCount,
            actualUntouchedExistingCount,
          });
          setError('기존 제품 첨부 보존 검증에 실패했습니다. 저장이 중단되었습니다. 첨부 상태를 확인 후 다시 저장해주세요.');
          setSaving(false);
          return;
        }
      }

      // 저장 직전 첨부 정합성 확정:
      // - 로드시점 스냅샷/Firestore/Storage 실파일을 다시 합쳐 PDF 입력 첨부를 보강한다.
      // - 본문만 수정해도 기존 PNG/PDF 첨부가 재생성 PDF에 포함되도록 강제한다.
      const normalizeNameForMatch = (value: string): string =>
        (value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const cachedStorageItems: Array<{ name: string; fullPath: string }> = [];
      try {
        const dirRef = ref(storage, `certificates/${certificateId}/inspection_certi`);
        const listed = await listAll(dirRef);
        listed.items.forEach((itemRef) => {
          cachedStorageItems.push({
            name: itemRef.name || '',
            fullPath: itemRef.fullPath || '',
          });
        });
      } catch (storageListError) {
        console.warn('[저장] 첨부 폴더 목록 조회 실패(기존 데이터로 계속):', storageListError);
      }

      const findStorageItemByName = (name: string): { name: string; fullPath: string } | null => {
        const target = normalizeNameForMatch(name);
        if (!target) return null;
        const matched = cachedStorageItems.find((item) => {
          const normalizedItem = normalizeNameForMatch(item.name);
          return normalizedItem === target || normalizedItem.includes(target) || target.includes(normalizedItem);
        });
        return matched || null;
      };

      for (let i = 0; i < productsDataForFirestore.length; i++) {
        const p = productsDataForFirestore[i];
        if (!p) continue;
        const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        let certs = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
          ? [...pWithCerts.inspectionCertificates]
          : [];

        if (certs.length === 0) {
          const fromLoaded = loadedExistingAttachmentsByIndex[i] || [];
          const fromFirestore = getExistingProductAttachmentsFallback(
            { productName: p.productName || '', productCode: p.productCode || '' },
            i
          );
          certs = fromLoaded.length > 0 ? [...fromLoaded] : [...fromFirestore];
        }

        const repairedCerts: CertificateAttachment[] = [];
        for (const cert of certs) {
          const nextCert: CertificateAttachment = { ...cert };
          let finalUrl = nextCert.url || '';

          if ((!nextCert.storagePath || nextCert.storagePath.trim().length === 0) && nextCert.name) {
            const matched = findStorageItemByName(nextCert.name);
            if (matched?.fullPath) {
              nextCert.storagePath = matched.fullPath;
            }
          }

          if (nextCert.storagePath && nextCert.storagePath.trim().length > 0) {
            try {
              const refreshedUrl = await getDownloadURL(ref(storage, nextCert.storagePath));
              if (refreshedUrl && refreshedUrl.trim().length > 0) {
                finalUrl = refreshedUrl;
                nextCert.url = refreshedUrl;
              }
            } catch {
              // 아래 fallback 계속
            }
          }

          if ((!finalUrl || finalUrl.trim().length === 0) && nextCert.name) {
            const rootFallback = findRootAttachmentFallback(nextCert.name);
            if (rootFallback) {
              nextCert.storagePath = nextCert.storagePath || rootFallback.storagePath;
              nextCert.type = nextCert.type || rootFallback.type;
              nextCert.size = nextCert.size || rootFallback.size;
              finalUrl = rootFallback.url || '';
              nextCert.url = finalUrl;
            }
          }

          if ((!nextCert.base64 || nextCert.base64.trim().length === 0) && finalUrl && finalUrl.trim().length > 0) {
            const base64 = await fetchUrlAsBase64DataUrl(finalUrl);
            if (base64) nextCert.base64 = base64;
          }

          // URL/경로/base64 중 하나라도 있으면 유지
          if (
            (nextCert.url && nextCert.url.trim().length > 0) ||
            (nextCert.storagePath && nextCert.storagePath.trim().length > 0) ||
            (nextCert.base64 && nextCert.base64.trim().length > 0)
          ) {
            repairedCerts.push(nextCert);
          }
        }

        const deduped = repairedCerts.filter((cert, idx, arr) => {
          const key = cert.storagePath && cert.storagePath.trim().length > 0
            ? `sp:${cert.storagePath.trim()}`
            : `nu:${cert.name || ''}::${cert.url || ''}`;
          return arr.findIndex((x) => {
            const xKey = x.storagePath && x.storagePath.trim().length > 0
              ? `sp:${x.storagePath.trim()}`
              : `nu:${x.name || ''}::${x.url || ''}`;
            return xKey === key;
          }) === idx;
        });

        pWithCerts.inspectionCertificates = deduped;
        p.inspectionCertificate = deduped[0];
      }

      // 제품별 첨부가 모두 비어있으면 storage 실파일을 첫 제품에 강제 배치
      const totalCertCountAfterRepair = productsDataForFirestore.reduce((sum, p) => {
        const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        const certs = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
          ? pWithCerts.inspectionCertificates
          : [];
        return sum + certs.length;
      }, 0);
      if (totalCertCountAfterRepair === 0 && cachedStorageItems.length > 0 && productsDataForFirestore.length > 0) {
        const recoveredFromStorage: CertificateAttachment[] = [];
        for (const item of cachedStorageItems) {
          try {
            const downloadUrl = await getDownloadURL(ref(storage, item.fullPath));
            const lower = (item.name || '').toLowerCase();
            const inferredType = lower.endsWith('.pdf')
              ? 'application/pdf'
              : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
                ? 'image/jpeg'
                : lower.endsWith('.webp')
                  ? 'image/webp'
                  : 'image/png';
            recoveredFromStorage.push({
              name: item.name || '',
              url: downloadUrl,
              storagePath: item.fullPath,
              size: 0,
              type: inferredType,
              uploadedAt: new Date(),
              uploadedBy: 'admin',
            });
          } catch {
            // 건너뜀
          }
        }
        if (recoveredFromStorage.length > 0) {
          const first = productsDataForFirestore[0] as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          first.inspectionCertificates = recoveredFromStorage;
          (productsDataForFirestore[0] as CertificateProduct).inspectionCertificate = recoveredFromStorage[0];
          console.log(`[저장] 첨부 전역 강제 복구 적용: ${recoveredFromStorage.length}개`);
        }
      }
      
      // 디버깅: productsDataForFirestore의 inspectionCertificates 확인 (기존 + 새 파일 모두 포함)
      console.log('[저장] PDF 생성 전 productsDataForFirestore 확인:', productsDataForFirestore.map((p, idx) => {
          const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const inspectionCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
            ? productWithCerts.inspectionCertificates
            : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
          
          const newFilesCount = inspectionCerts.filter(c => !!c.base64).length;
          const existingFilesCount = inspectionCerts.filter(c => !c.base64).length;
          
          return {
            productIndex: idx + 1,
            productName: p.productName,
            inspectionCertCount: inspectionCerts.length,
            newFilesCount,
            existingFilesCount,
            inspectionCerts: inspectionCerts.map((c, certIdx) => ({ 
              index: certIdx + 1,
              name: c.name, 
              url: c.url,
              hasBase64: !!c.base64,
              base64Length: c.base64 ? c.base64.length : 0,
              storagePath: c.storagePath,
              isNew: !!c.base64, // base64가 있으면 새 파일
              isExisting: !c.base64, // base64가 없으면 기존 파일
            })),
          };
        }));
        
        // 새 파일이 포함되었는지 전체 확인
        const totalNewFiles = productsDataForFirestore.reduce((sum, p) => {
          const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const inspectionCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
            ? productWithCerts.inspectionCertificates
            : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
          return sum + inspectionCerts.filter(c => !!c.base64).length;
        }, 0);
        console.log(`[저장] 📊 PDF 생성 전 전체 새 파일 개수: ${totalNewFiles}개 (모든 새 파일이 PDF에 포함되어야 함)`);
        if (totalNewFiles > 0) {
          console.log(`[저장] ✅ 새 파일 ${totalNewFiles}개가 PDF 생성에 포함될 예정`);
        } else {
          console.warn(`[저장] ⚠️ 새 파일이 없습니다. 새 파일을 추가했는데도 이 메시지가 보이면 문제가 있을 수 있습니다.`);
        }
        
        // PDF 생성 전 최종 확인: productsDataForFirestore의 inspectionCertificates가 제대로 포함되어 있는지 확인
        console.log('[저장] PDF 생성 함수 호출 전 최종 확인:', {
          totalProducts: productsDataForFirestore.length,
          products: productsDataForFirestore.map((p, idx) => {
            const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
            const inspectionCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
              ? productWithCerts.inspectionCertificates
              : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
            return {
              productIndex: idx + 1,
              productName: p.productName,
              inspectionCertCount: inspectionCerts.length,
              hasInspectionCertificates: !!productWithCerts.inspectionCertificates,
              isArray: Array.isArray(productWithCerts.inspectionCertificates),
              inspectionCerts: inspectionCerts.map((c, certIdx) => ({
                index: certIdx + 1,
                name: c.name,
                url: c.url,
                hasBase64: !!c.base64,
                base64Length: c.base64 ? c.base64.length : 0,
                isExisting: !c.base64, // base64가 없으면 기존 파일
              })),
            };
          }),
        });
        
      {
        let pdfResult: { blob: Blob; failedImageCount: number; fileValidationResults: ProductValidationResult[] } | null = null;
        {
        // PDF 생성 전 최종 검증: 모든 파일이 포함되었는지 확인
        // 첨부 파일 수정/삭제/추가 시 모두 반영되도록 검증
        const totalFilesBeforePDF = productsDataForFirestore.reduce((sum, p) => {
          const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const certs = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
            ? pWithCerts.inspectionCertificates
            : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
          return sum + certs.length;
        }, 0);
        console.log(`[저장] PDF 생성 전 최종 검증: 총 ${totalFilesBeforePDF}개 파일이 PDF에 포함될 예정 (모든 첨부 파일 반영)`);
        
        // PDF 생성 전 각 제품의 Inspection Certificate 파일 개수 확인 (검증용)
        const expectedFileCounts: Array<{ productIndex: number; productName: string; fileCount: number }> = [];
        productsDataForFirestore.forEach((p, idx) => {
          const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const inspectionCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
            ? productWithCerts.inspectionCertificates
            : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
          if (inspectionCerts.length > 0) {
            expectedFileCounts.push({
              productIndex: idx + 1,
              productName: p.productName || `제품 ${idx + 1}`,
              fileCount: inspectionCerts.length,
            });
          }
        });
        totalExpectedFiles = expectedFileCounts.reduce((sum, item) => sum + item.fileCount, 0);
        console.log(`[저장] PDF 생성 전 예상 파일 개수: 총 ${totalExpectedFiles}개 (${expectedFileCounts.length}개 제품)`);
        expectedFileCounts.forEach(item => {
          console.log(`[저장] 제품 ${item.productIndex} "${item.productName}": ${item.fileCount}개 파일 예상`);
        });
        
        // PDF 생성 (생성 페이지와 동일한 방식)
        // productsData는 이미 위에서 생성됨 (기존 파일 + 새 파일 모두 포함)
        try {
          // PDF 생성용 데이터: productsDataForFirestore의 깊은 복사본 생성 (참조 문제 방지)
          const productsDataForPDF: CertificateProduct[] = productsDataForFirestore.map((p, productIdx) => {
            const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
            
            // inspectionCertificates 배열 추출 (모든 파일 포함)
            let inspectionCerts: CertificateAttachment[] = [];
            if (pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)) {
              inspectionCerts = pWithCerts.inspectionCertificates;
              console.log(`[PDF 생성 준비] 제품 ${productIdx + 1} "${p.productName}" inspectionCertificates 배열 발견:`, inspectionCerts.length, '개');
            } else if (p.inspectionCertificate) {
              inspectionCerts = [p.inspectionCertificate];
              console.log(`[PDF 생성 준비] 제품 ${productIdx + 1} "${p.productName}" inspectionCertificate 단일 객체 발견`);
            } else {
              console.log(`[PDF 생성 준비] 제품 ${productIdx + 1} "${p.productName}" Inspection Certificate 없음`);
            }
            
            // 모든 파일이 URL을 가지고 있는지 확인
            const filesWithUrl = inspectionCerts.filter(cert => cert && cert.url && cert.url.trim().length > 0);
            const filesWithoutUrl = inspectionCerts.filter(cert => !cert || !cert.url || cert.url.trim().length === 0);
            
            if (filesWithoutUrl.length > 0) {
              console.warn(`[PDF 생성 준비] ⚠️ 제품 ${productIdx + 1} "${p.productName}" URL이 없는 파일 ${filesWithoutUrl.length}개 발견:`, filesWithoutUrl.map(f => f.name));
            }
            
            console.log(`[PDF 생성 준비] 제품 ${productIdx + 1} "${p.productName}" 최종 파일 개수:`, {
              total: inspectionCerts.length,
              withUrl: filesWithUrl.length,
              withoutUrl: filesWithoutUrl.length,
              files: inspectionCerts.map((c, idx) => ({
                index: idx + 1,
                name: c.name,
                url: c.url ? '있음' : '없음',
                hasBase64: !!c.base64,
                storagePath: c.storagePath,
              })),
            });
            
            // 깊은 복사본 생성
            const productCopy: CertificateProduct = {
              productName: p.productName,
              productCode: p.productCode,
              quantity: p.quantity,
              heatNo: p.heatNo,
              material: p.material,
            };

            // 비고는 값이 있을 때만 추가
            if (p.remark?.trim()) {
              productCopy.remark = p.remark.trim();
            }
            
            // inspectionCertificates 배열 깊은 복사 (모든 파일 포함, URL이 없어도 포함)
            const productCopyWithCerts = productCopy as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
            productCopyWithCerts.inspectionCertificates = inspectionCerts.map(cert => ({
              name: cert.name || '',
              url: cert.url || '',
              storagePath: cert.storagePath || undefined,
              size: cert.size || 0,
              type: cert.type || '',
              uploadedAt: cert.uploadedAt || new Date(),
              uploadedBy: cert.uploadedBy || 'admin',
              // base64 데이터도 포함 (새 파일의 경우)
              base64: cert.base64,
            }));
            
            // 첫 번째 파일을 inspectionCertificate에 저장 (하위 호환성)
            if (inspectionCerts.length > 0) {
              productCopy.inspectionCertificate = {
                name: inspectionCerts[0].name || '',
                url: inspectionCerts[0].url || '',
                storagePath: inspectionCerts[0].storagePath || undefined,
                size: inspectionCerts[0].size || 0,
                type: inspectionCerts[0].type || '',
                uploadedAt: inspectionCerts[0].uploadedAt || new Date(),
                uploadedBy: inspectionCerts[0].uploadedBy || 'admin',
                base64: inspectionCerts[0].base64,
              };
            }
            
            console.log(`[PDF 생성 준비] 제품 ${productIdx + 1} "${p.productName}" 최종 productCopyWithCerts:`, {
              hasInspectionCertificates: !!productCopyWithCerts.inspectionCertificates,
              isArray: Array.isArray(productCopyWithCerts.inspectionCertificates),
              length: productCopyWithCerts.inspectionCertificates?.length || 0,
              files: productCopyWithCerts.inspectionCertificates?.map((c, idx) => ({
                index: idx + 1,
                name: c.name,
                url: c.url ? '있음' : '없음',
                hasBase64: !!c.base64,
                storagePath: c.storagePath,
              })) || [],
            });
            
            return productCopyWithCerts;
          });
          
          console.log('[저장] PDF 생성 시작, productsDataForPDF 개수:', productsDataForPDF.length);
          console.log('[저장] PDF 생성 시 전달되는 productsDataForPDF:', productsDataForPDF.map((p, idx) => {
            const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
            const inspectionCerts = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
              ? pWithCerts.inspectionCertificates
              : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
            return {
              productIndex: idx + 1,
              productName: p.productName,
              inspectionCertCount: inspectionCerts.length,
              files: inspectionCerts.map((c, certIdx) => ({
                index: certIdx + 1,
                name: c.name,
                url: c.url ? '있음' : '없음',
                hasBase64: !!c.base64,
                base64Length: c.base64 ? c.base64.length : 0,
                storagePath: c.storagePath,
              })),
            };
          }));
          
          // Step 4) 최종 products 기준 PDF 생성
          pdfResult = await generateCertificatePdf(formData, productsDataForPDF);
          
          if (!pdfResult) {
            throw new Error('PDF 생성 결과를 받을 수 없습니다.');
          }
          
          pdfBlob = pdfResult.blob;
          failedImageCount = pdfResult.failedImageCount;
          console.log('[저장] PDF 생성 완료, 실패한 이미지:', failedImageCount);

          // Step 5) PDF 첨부 병합 (본문+이미지 생성 후 수행)
          const mergeResult = await mergePdfAttachments(pdfBlob, productsDataForPDF);
          pdfBlob = mergeResult.mergedBlob;

          // PDF 병합 결과를 상태에 반영
          const mergedKeySet = mergeResult.mergedAttachmentKeys;
          pdfResult.fileValidationResults.forEach((productResult, productIdx) => {
            const p = productsDataForPDF[productIdx];
            const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
            const certs = pWithCerts.inspectionCertificates && Array.isArray(pWithCerts.inspectionCertificates)
              ? pWithCerts.inspectionCertificates
              : (p?.inspectionCertificate ? [p.inspectionCertificate] : []);
            const pdfCerts = certs.filter((cert) => getAttachmentKind(cert) === 'pdf');
            const pdfQueue = [...pdfCerts];
            productResult.files = productResult.files.map((file) => {
              if (file.status !== 'kept_as_attachment') return file;
              const cert = pdfQueue.find((c) => (c.name || '이름 없음') === file.fileName);
              if (!cert) return file;
              const key = getAttachmentIdentityKey(cert);
              const merged = mergedKeySet.has(key);
              if (merged) {
                return { ...file, status: 'merged_pdf', error: undefined };
              }
              return { ...file, status: 'failed', error: file.error || 'PDF 첨부 병합에 실패했습니다.' };
            });
          });
          if (mergeResult.failedPdfAttachments.length > 0) {
            failedImageCount += mergeResult.failedPdfAttachments.length;
          }
        } catch (pdfError) {
          console.error('[저장] PDF 생성 오류:', pdfError);
          const errorMessage = pdfError instanceof Error ? pdfError.message : String(pdfError);
          
          // PDF 생성 실패 시 저장 중단 및 상세 에러 메시지 표시
          let detailedErrorMessage = `❌ PDF 생성에 실패했습니다. 저장이 중단되었습니다.\n\n`;
          detailedErrorMessage += `오류 원인: ${errorMessage}\n\n`;
          
          if (errorMessage.includes('타임아웃')) {
            detailedErrorMessage += `• PDF 생성 시간이 120초를 초과했습니다.\n`;
            detailedErrorMessage += `• 네트워크 연결 상태를 확인하거나 Inspection Certificate 파일 크기를 확인해주세요.\n`;
            detailedErrorMessage += `• 파일이 너무 크거나 많을 경우 시간이 오래 걸릴 수 있습니다.\n`;
          } else {
            detailedErrorMessage += `• PDF 생성 중 예기치 않은 오류가 발생했습니다.\n`;
            detailedErrorMessage += `• 브라우저 콘솔을 확인하여 추가 정보를 확인하세요.\n`;
          }
          
          setError(detailedErrorMessage);
          setSaving(false);
          return; // 저장 중단
        }
        
        // PDF 생성 후 검증: Inspection Certificate 파일 포함 여부 확인
        if (!pdfResult) {
          setError('PDF 생성 결과를 확인할 수 없습니다. 저장이 중단되었습니다.');
          setSaving(false);
          return; // 저장 중단
        }
        
        const totalSuccessFiles = totalExpectedFiles - failedImageCount;
        console.log(`[저장] PDF 생성 후 검증: 예상 ${totalExpectedFiles}개, 성공 ${totalSuccessFiles}개, 실패 ${failedImageCount}개`);

        // 첨부 이미지 누락 시 저장을 계속 진행하면 기존 정상 PDF가 누락본으로 덮어써지는 문제가 발생하므로
        // 하나라도 실패하면 저장을 중단한다.
        let pdfIncludeWarningMessage = '';
        
        // 실패한 파일이 있으면 상세 정보 수집
        if (failedImageCount > 0) {
          let detailedErrorMessage = `❌ ${failedImageCount}개의 Inspection Certificate 파일을 PDF에 포함하지 못했습니다. 저장이 중단되었습니다.\n\n`;
          detailedErrorMessage += `실패한 파일 상세 정보:\n\n`;
          
          // fileValidationResults에서 실패한 파일 정보 추출
          const failedFilesDetails: Array<{ productName: string; fileName: string; error?: string }> = [];
          let hasFailureInTouchedProducts = false;
          pdfResult.fileValidationResults.forEach(productResult => {
            const isTouchedProduct = touchedAttachmentProductIndexes.has(productResult.productIndex - 1);
            productResult.files.forEach(file => {
              if (file.status === 'failed') {
                failedFilesDetails.push({
                  productName: productResult.productName,
                  fileName: file.fileName,
                  error: file.error,
                });
                if (isTouchedProduct) {
                  hasFailureInTouchedProducts = true;
                }
              }
            });
          });
          
          // 실패한 파일 목록 표시
          failedFilesDetails.forEach((failed, idx) => {
            detailedErrorMessage += `${idx + 1}. 제품 "${failed.productName}" - 파일 "${failed.fileName}"`;
            if (failed.error) {
              detailedErrorMessage += `\n   오류: ${failed.error}`;
            }
            detailedErrorMessage += `\n`;
          });
          
          detailedErrorMessage += `\n가능한 원인:\n`;
          detailedErrorMessage += `• 파일 URL이 유효하지 않거나 접근할 수 없습니다.\n`;
          detailedErrorMessage += `• 네트워크 연결 문제로 파일을 다운로드할 수 없습니다.\n`;
          detailedErrorMessage += `• 파일 형식이 지원되지 않거나 손상되었습니다.\n`;
          detailedErrorMessage += `• 파일 크기가 너무 커서 처리할 수 없습니다.\n`;

          // 누락이 1건이라도 있으면 저장 중단 (목록/다운로드 불일치 방지)
          if (hasFailureInTouchedProducts || failedFilesDetails.length > 0) {
            pdfIncludeWarningMessage = detailedErrorMessage;
            setError(pdfIncludeWarningMessage);
            setSaving(false);
            return;
          }
        } else if (totalExpectedFiles > 0) {
          console.log(`[저장] ✅ 모든 Inspection Certificate 파일(${totalExpectedFiles}개)이 PDF에 성공적으로 포함되었습니다.`);
          // 성공 메시지는 저장 완료 후 표시
        } else {
          console.log(`[저장] ℹ️ Inspection Certificate 파일이 없습니다.`);
        }

        if (pdfResult) {
          renderedImageCount = pdfResult.fileValidationResults.reduce(
            (sum, p) => sum + p.files.filter((f) => f.status === 'rendered_image').length,
            renderedImageCount
          );
          mergedPdfCount = pdfResult.fileValidationResults.reduce(
            (sum, p) => sum + p.files.filter((f) => f.status === 'merged_pdf').length,
            mergedPdfCount
          );
          keptAttachmentCount = pdfResult.fileValidationResults.reduce(
            (sum, p) => sum + p.files.filter((f) => f.status === 'kept_as_attachment').length,
            keptAttachmentCount
          );
        }
      }
      const fileName = `MATERIAL_TEST_CERTIFICATE_${formData.certificateNo || 'CERT'}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // PDF를 재생성하는 경우에만 blob 필수
      if (shouldRegeneratePdf && !pdfBlob) {
        setError('PDF 생성에 실패했습니다. 다시 시도해주세요.');
        setSaving(false);
        return;
      }

      // 기존 PDF를 재생성하는 경우에만 교체 업로드
      if (shouldRegeneratePdf && existingCertificateFileStoragePath) {
        try {
          console.log('[저장] 기존 PDF 파일 삭제 시도:', existingCertificateFileStoragePath);
          const existingFileRef = ref(storage, existingCertificateFileStoragePath);
          await deleteObject(existingFileRef);
          console.log('[저장] ✅ 기존 PDF 파일 삭제 완료');
        } catch (deleteError: unknown) {
          // 삭제 실패해도 계속 진행 (파일이 이미 없을 수 있음)
          const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
          console.warn('[저장] ⚠️ 기존 PDF 파일 삭제 실패 (계속 진행):', errorMessage);
        }
      }
      
      if (shouldRegeneratePdf) {
        // 새 PDF 업로드 (기존 파일 대체 - 같은 파일명으로 저장하여 덮어쓰기)
        console.log('[저장] 새 PDF 업로드 시작 (기존 파일 대체), 크기:', pdfBlob!.size, 'bytes');
        const storageFileName = `certificate_${formData.certificateNo.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        const filePath = `certificates/${certificateId}/${storageFileName}`;
        
        console.log('[저장] PDF 저장 경로 (기존 파일 대체):', filePath);
        const storageRef = ref(storage, filePath);
        
        try {
          await uploadBytes(storageRef, pdfBlob!);
          console.log('[저장] ✅ PDF 업로드 완료');
        } catch (uploadError) {
          console.error('[저장] ❌ PDF 업로드 실패:', uploadError);
          throw new Error(`PDF 파일 업로드에 실패했습니다: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`);
        }
        
        let downloadURL: string;
        try {
          downloadURL = await getDownloadURL(storageRef);
          console.log('[저장] ✅ PDF 다운로드 URL 획득:', downloadURL);
        } catch (urlError) {
          console.error('[저장] ❌ PDF 다운로드 URL 획득 실패:', urlError);
          throw new Error(`PDF 다운로드 URL 획득에 실패했습니다: ${urlError instanceof Error ? urlError.message : String(urlError)}`);
        }
        
        certificateFile = {
          name: fileName,
          url: downloadURL,
          storagePath: filePath,
          size: pdfBlob!.size,
          type: 'application/pdf',
          uploadedAt: new Date(),
          uploadedBy: 'admin',
        };
      }

      if (!certificateFile) {
        setError('PDF 파일 정보를 준비하지 못했습니다.');
        setSaving(false);
        return;
      }
      
      console.log('[저장] certificateFile 정보:', {
        name: certificateFile.name,
        url: certificateFile.url,
        size: certificateFile.size,
        type: certificateFile.type,
      });

      // Firestore에 저장할 때는 Timestamp로 변환하고 undefined 필드 제거
      // productsDataForFirestore 사용 (기존 파일 + 새 파일 모두 포함)
      console.log('[저장] Firestore 저장용 productsDataForFirestore 확인:', productsDataForFirestore.map((p, idx) => {
        const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        return {
          index: idx + 1,
          productName: p.productName,
          inspectionCertificatesCount: pWithCerts.inspectionCertificates?.length || 0,
          files: pWithCerts.inspectionCertificates?.map((c, certIdx) => ({
            index: certIdx + 1,
            name: c.name,
            url: c.url,
            isExisting: !c.base64, // base64가 없으면 기존 파일
          })) || [],
        };
      }));
      
      const materialTestCertificateForFirestore: Record<string, unknown> = {
        certificateNo: materialTestCertificate.certificateNo,
        dateOfIssue: Timestamp.fromDate(materialTestCertificate.dateOfIssue),
        customer: materialTestCertificate.customer,
        poNo: materialTestCertificate.poNo,
        products: productsDataForFirestore.map(p => {
          const productForFirestore: Record<string, unknown> = {
            productName: p.productName,
            productCode: p.productCode || null,
            quantity: p.quantity || null,
            heatNo: p.heatNo || null,
            material: p.material || null,
          };

          // 비고는 값이 있을 때만 추가
          if (p.remark?.trim()) {
            productForFirestore.remark = p.remark.trim();
          }
          
          // inspectionCertificates 배열이 있으면 저장 (여러 파일 지원)
          const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const inspectionCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
            ? productWithCerts.inspectionCertificates
            : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
          
          // inspectionCertificates 배열을 항상 저장 (파일이 없어도 빈 배열로 저장)
          // 모든 파일을 inspectionCertificates 배열로 저장
          productForFirestore.inspectionCertificates = inspectionCerts.map((cert: CertificateAttachment) => {
              let certUploadedAtTimestamp: Timestamp;
              const certUploadedAt = cert.uploadedAt;
              if (certUploadedAt) {
                if (certUploadedAt instanceof Date) {
                  certUploadedAtTimestamp = Timestamp.fromDate(certUploadedAt);
                } else if (certUploadedAt && typeof certUploadedAt === 'object' && 'toDate' in certUploadedAt) {
                  const timestampObj = certUploadedAt as { toDate?: () => Date };
                  if (typeof timestampObj.toDate === 'function') {
                    certUploadedAtTimestamp = certUploadedAt as Timestamp;
                  } else {
                    certUploadedAtTimestamp = Timestamp.fromDate(new Date());
                  }
                } else {
                  certUploadedAtTimestamp = Timestamp.fromDate(new Date());
                }
              } else {
                certUploadedAtTimestamp = Timestamp.fromDate(new Date());
              }
              
              return {
                name: cert.name,
                url: cert.url,
                storagePath: cert.storagePath || null,
                size: cert.size,
                type: cert.type,
                uploadedAt: certUploadedAtTimestamp,
                uploadedBy: cert.uploadedBy,
              };
            });
            
            // 첫 번째 파일을 inspectionCertificate에 저장 (하위 호환성, 파일이 있을 때만)
            if (inspectionCerts.length > 0) {
              const firstCert = inspectionCerts[0];
              let uploadedAtTimestamp: Timestamp;
              const uploadedAt = firstCert.uploadedAt;
              if (uploadedAt) {
                if (uploadedAt instanceof Date) {
                  uploadedAtTimestamp = Timestamp.fromDate(uploadedAt);
                } else if (uploadedAt && typeof uploadedAt === 'object' && 'toDate' in uploadedAt) {
                  const timestampObj = uploadedAt as { toDate?: () => Date };
                  if (typeof timestampObj.toDate === 'function') {
                    uploadedAtTimestamp = uploadedAt as Timestamp;
                  } else {
                    uploadedAtTimestamp = Timestamp.fromDate(new Date());
                  }
                } else {
                  uploadedAtTimestamp = Timestamp.fromDate(new Date());
                }
              } else {
                uploadedAtTimestamp = Timestamp.fromDate(new Date());
              }
              
              productForFirestore.inspectionCertificate = {
                name: firstCert.name,
                url: firstCert.url,
                storagePath: firstCert.storagePath || null,
                size: firstCert.size,
                type: firstCert.type,
                uploadedAt: uploadedAtTimestamp,
                uploadedBy: firstCert.uploadedBy,
              };
            } else {
              // 파일이 없으면 null로 설정
              productForFirestore.inspectionCertificate = null;
            }
          
          return productForFirestore;
        }),
        testResult: materialTestCertificate.testResult,
        createdAt: Timestamp.fromDate(materialTestCertificate.createdAt),
        updatedAt: Timestamp.fromDate(materialTestCertificate.updatedAt),
        createdBy: materialTestCertificate.createdBy,
      };

      const certificateFileForFirestore = {
        ...certificateFile,
        storagePath: certificateFile.storagePath || null, // storagePath 저장 (다음 수정 시 삭제용)
        uploadedAt: Timestamp.fromDate(certificateFile.uploadedAt),
      };

      console.log('[저장] Firestore 업데이트 시작');
      console.log('[저장] 업데이트할 데이터:', {
        certificateId,
        hasMaterialTestCertificate: !!materialTestCertificateForFirestore,
        hasCertificateFile: !!certificateFileForFirestore,
        certificateFileUrl: certificateFileForFirestore.url,
      });
      
      // Firestore 업데이트 (수정 시 항상 새 PDF와 모든 첨부 파일 반영)
      try {
        console.log('[저장] Firestore 업데이트 시작 - 새 PDF 및 모든 첨부 파일 반영');
        await saveCertificateDocument(
          certificateId,
          materialTestCertificateForFirestore,
          certificateFileForFirestore
        );
        console.log('[저장] ✅ Firestore 업데이트 완료 - 새 PDF 및 모든 첨부 파일 반영됨');
      } catch (updateError) {
        console.error('[저장] ❌ Firestore 업데이트 실패:', updateError);
        throw new Error(`Firestore 업데이트에 실패했습니다: ${updateError instanceof Error ? updateError.message : String(updateError)}`);
      }

      // 성공 메시지 생성 (실제 처리 상태를 분리 표시)
      let successMessage = '✅ 본문 PDF 재생성 및 저장이 완료되었습니다.';
      successMessage += `\n- 이미지 첨부 PDF 반영: ${renderedImageCount}건`;
      successMessage += `\n- PDF 첨부 병합: ${mergedPdfCount}건`;
      successMessage += `\n- Office/기타 첨부 별도 유지: ${keptAttachmentCount}건`;
      if (failedImageCount > 0) {
        successMessage += `\n- 렌더링 실패: ${failedImageCount}건`;
      }
      if (totalExpectedFiles === 0) {
        successMessage += `\n- 첨부 파일 없음`;
      }
      
      setSuccess(successMessage);
      
      // 저장 후 상태 업데이트는 불필요 (저장 후 목록 페이지로 이동하므로)
      
      // 저장 완료 즉시 목록으로 이동 (체감 지연 제거)
      router.push(isV2Flow ? '/admin/certificate/list2' : '/admin/certificate');
      }
    } catch (error) {
      console.error('저장 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`저장에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  };

  if (loadingCertificate) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">로딩 중...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">성적서 수정</h1>
        <p className="text-gray-600 mt-2">성적서 내용을 수정하고 PDF를 재생성할 수 있습니다</p>
      </div>

      {error && (
        <div className="bg-red-50 border-2 border-red-400 text-red-800 px-6 py-4 rounded-lg shadow-md mb-6">
          <p className="font-semibold">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border-2 border-green-400 text-green-800 px-6 py-4 rounded-lg shadow-md mb-6">
          <p className="font-semibold">{success}</p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          <div className="space-y-6">
            {/* 기본 정보 섹션 */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">기본 정보</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Input
                    id="certificateNo"
                    name="certificateNo"
                    type="text"
                    label="CERTIFICATE NO. *"
                    required
                    value={formData.certificateNo}
                    onChange={handleChange}
                    placeholder="성적서 번호"
                    disabled={true}
                    className="bg-gray-50 cursor-not-allowed"
                  />
                  {formErrors.certificateNo && (
                    <p className="mt-1 text-sm text-red-600">{formErrors.certificateNo}</p>
                  )}
                </div>
                <div>
                  <Input
                    id="dateOfIssue"
                    name="dateOfIssue"
                    type="date"
                    label="DATE OF ISSUE *"
                    required
                    value={formData.dateOfIssue}
                    onChange={(e) => {
                      handleChange(e);
                      // 입력 시 해당 필드 에러 제거
                      if (formErrors.dateOfIssue) {
                        setFormErrors(prev => ({ ...prev, dateOfIssue: undefined }));
                      }
                    }}
                  />
                  {formErrors.dateOfIssue && (
                    <p className="mt-1 text-sm text-red-600">{formErrors.dateOfIssue}</p>
                  )}
                </div>
                <div>
                  <Input
                    id="customer"
                    name="customer"
                    type="text"
                    label="CUSTOMER *"
                    required
                    value={formData.customer}
                    onChange={(e) => {
                      handleChange(e);
                      // 입력 시 해당 필드 에러 제거
                      if (formErrors.customer) {
                        setFormErrors(prev => ({ ...prev, customer: undefined }));
                      }
                    }}
                    onBlur={handleFormBlur}
                    placeholder="고객명"
                    style={{ textTransform: 'uppercase' }}
                  />
                  {formErrors.customer && (
                    <p className="mt-1 text-sm text-red-600">{formErrors.customer}</p>
                  )}
                </div>
                <div>
                  <Input
                    id="poNo"
                    name="poNo"
                    type="text"
                    label="PO NO."
                    value={formData.poNo}
                    onChange={handleChange}
                    onBlur={handleFormBlur}
                    placeholder="발주번호"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>
              </div>

              {/* 제품 정보 섹션 */}
              <div className="mt-6">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">제품 정보 *</h2>
                </div>

                {products.map((product, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-4 bg-gray-50 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-gray-700">제품 {index + 1}</h3>
                      {products.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveProduct(index)}
                          disabled={saving}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          삭제
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <Input
                              id={`productName-${index}`}
                              type="text"
                              label="DESCRIPTION (제품명) *"
                              required
                              value={product.productName}
                              onChange={(e) => {
                                handleProductChange(index, 'productName', e.target.value);
                                // 입력 시 해당 필드 에러 제거
                                if (formErrors.products && formErrors.products[index]?.productName) {
                                  setFormErrors(prev => {
                                    const newErrors = { ...prev };
                                    if (newErrors.products && newErrors.products[index]) {
                                      newErrors.products[index] = { ...newErrors.products[index], productName: undefined };
                                    }
                                    return newErrors;
                                  });
                                }
                              }}
                              onBlur={(e) => {
                                handleProductBlur(index, 'productName', e.target.value);
                                handleProductNameBlur(index);
                              }}
                              placeholder="제품명 코드 입력 (예: GMC)"
                              style={{ textTransform: 'uppercase' }}
                              disabled={saving}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentProductIndex(index);
                              setCurrentProductCode('');
                              setShowMappingModal(true);
                            }}
                            disabled={saving}
                            className="mb-0.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="제품명코드 매핑 추가"
                          >
                            +
                          </button>
                        </div>
                        {formErrors.products && formErrors.products[index]?.productName && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.products[index].productName}</p>
                        )}
                      </div>

                      <div>
                        <Input
                          id={`productCode-${index}`}
                          type="text"
                          label="CODE (제품코드) *"
                          required
                          value={product.productCode}
                          onChange={(e) => {
                            handleProductChange(index, 'productCode', e.target.value);
                            // 입력 시 해당 필드 에러 제거
                            if (formErrors.products && formErrors.products[index]?.productCode) {
                              setFormErrors(prev => {
                                const newErrors = { ...prev };
                                if (newErrors.products && newErrors.products[index]) {
                                  newErrors.products[index] = { ...newErrors.products[index], productCode: undefined };
                                }
                                return newErrors;
                              });
                            }
                          }}
                          onBlur={(e) => handleProductBlur(index, 'productCode', e.target.value)}
                          placeholder="제품코드를 입력하세요"
                          style={{ textTransform: 'uppercase' }}
                          disabled={saving}
                        />
                        {formErrors.products && formErrors.products[index]?.productCode && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.products[index].productCode}</p>
                        )}
                      </div>

                      <div>
                        <Input
                          id={`quantity-${index}`}
                          type="text"
                          inputMode="numeric"
                          label="Q'TY (수량) *"
                          required
                          value={product.quantity}
                          onChange={(e) => {
                            handleProductChange(index, 'quantity', e.target.value);
                            // 입력 시 해당 필드 에러 제거
                            if (formErrors.products && formErrors.products[index]?.quantity) {
                              setFormErrors(prev => {
                                const newErrors = { ...prev };
                                if (newErrors.products && newErrors.products[index]) {
                                  newErrors.products[index] = { ...newErrors.products[index], quantity: undefined };
                                }
                                return newErrors;
                              });
                            }
                          }}
                          placeholder="수량을 입력하세요"
                          pattern="[0-9]*"
                          disabled={saving}
                        />
                        {formErrors.products && formErrors.products[index]?.quantity && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.products[index].quantity}</p>
                        )}
                      </div>

                      <Input
                        type="text"
                        label="MATERIAL (소재)"
                        value={product.material}
                        onChange={(e) => handleProductChange(index, 'material', e.target.value)}
                        onBlur={(e) => handleProductBlur(index, 'material', e.target.value)}
                        placeholder="소재를 입력하세요 (예: 316/316L, 304)"
                        style={{ textTransform: 'uppercase' }}
                        disabled={saving}
                      />

                      <Input
                        type="text"
                        label="HEAT NO. (히트번호)"
                        value={product.heatNo}
                        onChange={(e) => handleProductChange(index, 'heatNo', e.target.value)}
                        onBlur={(e) => handleProductBlur(index, 'heatNo', e.target.value)}
                        placeholder="히트번호를 입력하세요"
                        style={{ textTransform: 'uppercase' }}
                        disabled={saving}
                      />

                      <Input
                        type="text"
                        label="REMARK (비고)"
                        value={product.remark}
                        onChange={(e) => handleProductChange(index, 'remark', e.target.value)}
                        onBlur={(e) => handleProductBlur(index, 'remark', e.target.value)}
                        placeholder="비고를 입력하세요"
                        style={{ textTransform: 'uppercase' }}
                        disabled={saving}
                      />
                    </div>

                    {/* 제품별 Inspection Certi 첨부 */}
                    <div className="mt-4">
                      <h3 className="text-md font-semibold text-gray-800 mb-3">INSPECTION CERTIFICATE 첨부 (제품 {index + 1})</h3>
                      
                      {/* 모든 파일 목록 (구분 제거) */}
                      {product.inspectionCertificates && product.inspectionCertificates.length > 0 && (
                        <div className="mb-3 space-y-2">
                          <p className="text-sm text-gray-600 mb-2 font-medium">새 파일 (MTC에 포함됨)</p>
                          {product.inspectionCertificates.map((item, itemIndex) => {
                            const isFile = item instanceof File;
                            const fileName = isFile ? item.name : item.name;
                            const fileSize = isFile ? item.size : (item as CertificateAttachment).size;
                            
                            return (
                              <div key={itemIndex} className="p-3 bg-gray-50 rounded-md border border-gray-200">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <span className="text-sm text-gray-900 font-medium">{fileName}</span>
                                    <span className="text-xs text-blue-600 font-medium">(MTC에 포함됨)</span>
                                    {fileSize && (
                                      <span className="text-xs text-gray-500">
                                        ({(fileSize / 1024).toFixed(1)} KB)
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteInspectionCerti(index, itemIndex)}
                                      disabled={saving}
                                      className="text-red-600 hover:text-red-800 text-sm font-medium underline disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="파일 삭제"
                                    >
                                      삭제
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* 파일 선택 입력 */}
                      <div>
                        <input
                          type="file"
                          multiple
                          data-index={index}
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const selectedFiles = e.target.files;
                            console.log('[파일 입력] onChange 이벤트 발생:', {
                              index,
                              fileCount: selectedFiles?.length || 0,
                              fileNames: selectedFiles ? Array.from(selectedFiles).map(f => f.name) : [],
                            });
                            if (selectedFiles && selectedFiles.length > 0) {
                              console.log('[파일 입력] handleProductInspectionCertiAdd 호출');
                              handleProductInspectionCertiAdd(index, selectedFiles);
                            } else {
                              console.log('[파일 입력] 선택된 파일이 없습니다.');
                            }
                            // 파일 입력 필드 초기화는 상태 업데이트 후에 수행 (같은 파일 다시 선택 가능하도록)
                            setTimeout(() => {
                              e.target.value = '';
                            }, 100);
                          }}
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={saving}
                        />
                        <p className="mt-1 text-xs text-gray-500">여러 파일을 선택할 수 있습니다.</p>
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* 제품 추가 버튼 */}
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddProduct}
                    disabled={saving}
                    className="text-sm"
                  >
                    + 제품 추가
                  </Button>
                </div>
              </div>

            </div>

            {/* 액션 버튼 */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(isV2Flow ? '/admin/certificate/list2' : '/admin/certificate')}
                disabled={saving}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSave}
                disabled={saving}
                loading={saving}
              >
                저장
              </Button>
            </div>
          </div>
        </form>

        {/* 제품명코드 매핑 추가 모달 (새 제품명 입력 시 매핑 없을 때) */}
        {showMappingModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  {currentProductCode ? `제품명코드 "${currentProductCode}" 매핑 추가` : '제품명코드 매핑 관리'}
                </h2>
                <button
                  onClick={() => {
                    setShowMappingModal(false);
                    setCurrentProductIndex(null);
                    setCurrentProductCode('');
                    setEditingMapping(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                  type="button"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {editingMapping ? (
                <CertificateEditEditMappingForm
                  mapping={editingMapping}
                  onSave={(productName) => {
                    if (editingMapping.id) handleUpdateMapping(editingMapping.id, productName);
                  }}
                  onCancel={() => setEditingMapping(null)}
                />
              ) : (
                <CertificateEditAddMappingForm
                  initialProductCode={currentProductCode}
                  onSave={(productCode, productName) => handleAddMapping(productCode, productName)}
                  onCancel={() => {
                    setShowMappingModal(false);
                    setCurrentProductIndex(null);
                    setCurrentProductCode('');
                  }}
                />
              )}

              <div className="mt-6 border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">등록된 매핑 목록</h3>
                  <button
                    onClick={() => setShowMappingList(!showMappingList)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    {showMappingList ? '접기' : '펼치기'}
                  </button>
                </div>
                {showMappingList && (
                  <>
                    <div className="mb-3">
                      <input
                        type="text"
                        value={mappingSearchQuery}
                        onChange={(e) => setMappingSearchQuery(e.target.value.toUpperCase())}
                        placeholder="제품코드 또는 제품명으로 검색"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        style={{ textTransform: 'uppercase' }}
                      />
                    </div>
                    <div className="space-y-2 min-h-[6rem] max-h-72 overflow-y-auto overscroll-y-contain rounded border border-gray-200 bg-gray-50/50 px-2 py-2">
                      {(() => {
                        const q = mappingSearchQuery.trim().toLowerCase();
                        const filtered = q
                          ? allMappings.filter(
                              (m) =>
                                m.productCode.toLowerCase().includes(q) ||
                                m.productName.toLowerCase().includes(q)
                            )
                          : allMappings;
                        if (filtered.length === 0) {
                          return (
                            <p className="text-sm text-gray-500 text-center py-4">
                              {allMappings.length === 0 ? '등록된 매핑이 없습니다.' : '검색 결과가 없습니다.'}
                            </p>
                          );
                        }
                        return filtered.map((mapping) => (
                          <div
                            key={mapping.id}
                            className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 flex-nowrap"
                          >
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-900 whitespace-nowrap">{mapping.productCode}</span>
                              <span className="text-sm text-gray-500 mx-2">→</span>
                              <span className="text-sm text-gray-700 whitespace-nowrap">{mapping.productName}</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingMapping(mapping)}
                                className="text-blue-600 hover:text-blue-800 text-sm"
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                onClick={() => mapping.id && handleDeleteMapping(mapping.id)}
                                className="text-red-600 hover:text-red-800 text-sm"
                              >
                                삭제
                              </button>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 성적서 수정용 매핑 추가 폼
function CertificateEditAddMappingForm({
  initialProductCode,
  onSave,
  onCancel,
}: {
  initialProductCode: string;
  onSave: (productCode: string, productName: string) => void;
  onCancel: () => void;
}) {
  const [productCode, setProductCode] = useState(initialProductCode);
  const [productName, setProductName] = useState('');
  const productCodeInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProductCode(initialProductCode);
  }, [initialProductCode]);

  const handleProductCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProductCode(e.target.value);
  };

  const handleProductCodeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setProductCode(e.target.value.toUpperCase());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productCode.trim() || !productName.trim()) {
      alert('제품명코드와 제품명을 모두 입력해주세요.');
      return;
    }
    onSave(productCode.trim().toUpperCase(), productName.trim().toUpperCase());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">제품명코드 *</label>
        <Input
          ref={productCodeInputRef}
          type="text"
          value={productCode}
          onChange={handleProductCodeChange}
          onBlur={handleProductCodeBlur}
          placeholder="예: GMC"
          required
          style={{ textTransform: 'uppercase' }}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">제품명 *</label>
        <Input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          onBlur={(e) => setProductName(e.target.value.toUpperCase())}
          placeholder="예: MALE CONNECTOR"
          required
          style={{ textTransform: 'uppercase' }}
        />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>취소</Button>
        <Button type="submit" variant="primary">저장</Button>
      </div>
    </form>
  );
}

// 성적서 수정용 매핑 수정 폼
function CertificateEditEditMappingForm({
  mapping,
  onSave,
  onCancel,
}: {
  mapping: ProductMapping;
  onSave: (productName: string) => void;
  onCancel: () => void;
}) {
  const [productName, setProductName] = useState(mapping.productName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) {
      alert('제품명을 입력해주세요.');
      return;
    }
    onSave(productName.trim().toUpperCase());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">제품명코드</label>
        <Input type="text" value={mapping.productCode} disabled className="bg-gray-100" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">제품명 *</label>
        <Input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          onBlur={(e) => setProductName(e.target.value.toUpperCase())}
          placeholder="예: MALE CONNECTOR"
          required
          style={{ textTransform: 'uppercase' }}
        />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>취소</Button>
        <Button type="submit" variant="primary">저장</Button>
      </div>
    </form>
  );
}

export default function MaterialTestCertificateEditPage() {
  return (
    <Suspense fallback={
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">로딩 중...</p>
          </div>
        </div>
      </div>
    }>
      <MaterialTestCertificateEditContent />
    </Suspense>
  );
}


