"use client";

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, doc, getDoc, updateDoc, addDoc, Timestamp, getDocs, query, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { CertificateAttachment, MaterialTestCertificate, CertificateProduct } from '@/types';

const ADMIN_SESSION_KEY = 'admin_session';

// jsPDF 타입 정의 (필요한 메서드만 포함)
interface JSPDFDocument {
  addImage: (imgData: string, format: string, x: number, y: number, width: number, height: number) => void;
  setFont: (fontName: string, fontStyle?: string) => void;
  setFontSize: (size: number) => void;
  text: (text: string | string[], x: number, y: number, options?: { align?: 'center' | 'left' | 'right' | 'justify' }) => JSPDFDocument;
  getTextWidth: (text: string) => number;
}

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
  fileValidationResults: Array<{
    productIndex: number;
    productName: string;
    files: Array<{
      fileName: string;
      included: boolean;
      error?: string;
    }>;
  }>;
}> => {
  // 동적 import로 jsPDF 로드
  const { jsPDF } = await import('jspdf');
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
  yPosition = titleYPosition + 10;

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

  // 제품 테이블 헤더 (DESCRIPTION을 더 넓게, Q'ty, Material, Result, Heat No.는 조금씩 줄임)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  const colNo = margin; // 12mm
  const colDescription = margin + 8; // 20mm
  const colCode = margin + 70; // Code를 오른쪽으로 이동하여 Description 공간 확대 (60 -> 70, 10mm 증가)
  const colQty = margin + 108; // Q'ty를 조금 오른쪽으로 이동 (103.3 -> 108, 4.7mm 증가)
  const colMaterial = margin + 148; // Material을 조금 오른쪽으로 이동 (143.75 -> 148, 4.25mm 증가)
  // Material, Result, Heat No. 간격을 동일하게 배치
  const availableWidth = pageWidth - margin - colMaterial; // 사용 가능한 너비
  const colResult = colMaterial + availableWidth / 3; // Material, Result, Heat No. 간격 동일하게
  const colHeatNo = colMaterial + (availableWidth * 2) / 3; // Material, Result, Heat No. 간격 동일하게
  
  doc.text('No.', colNo, yPosition);
  doc.text('DESCRIPTION', colDescription, yPosition);
  doc.text('CODE', colCode, yPosition);
  doc.text("Q'TY", colQty, yPosition);
  doc.text('MATERIAL', colMaterial, yPosition);
  doc.text('RESULT', colResult, yPosition);
  doc.text('HEAT NO.', colHeatNo, yPosition);
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
    }
    
    doc.text(`${index + 1}.`, colNo, yPosition);
    const descriptionText = product.productName || '-';
    // DESCRIPTION 열 너비 조정 (더 넓게 설정하여 한 줄로 표시)
    const descriptionWidth = colCode - colDescription - 2; // 약 60mm (Code 이동으로 10mm 증가)
    const descriptionLines = doc.splitTextToSize(descriptionText, descriptionWidth);
    let descY = yPosition;
    descriptionLines.forEach((line: string) => {
      renderKoreanText(doc, line, colDescription, descY, 10);
      descY += 5;
    });
    // CODE 열 너비 조정 (10% 넓게 설정하여 한 줄로 표시)
    const codeWidth = colQty - colCode - 2; // 약 30.8mm (10% 증가)
    const codeLines = doc.splitTextToSize(product.productCode || '-', codeWidth);
    let codeY = yPosition;
    codeLines.forEach((line: string) => {
      renderKoreanText(doc, line, colCode, codeY, 10);
      codeY += 5;
    });
    // Q'TY 열 (간격 확보)
    doc.text((product.quantity || 0).toString(), colQty, yPosition);
    // HEAT NO. 열 먼저 처리하여 줄 수 확인
    const heatNoWidth = (pageWidth - margin) - colHeatNo - 2; // 약 20mm
    const heatNoText = product.heatNo || '-';
    const heatNoLines = doc.splitTextToSize(heatNoText, heatNoWidth);
    const heatNoLineCount = heatNoLines.length;
    
    // MATERIAL 열 (Q'TY 우측에 배치, Heat No. 줄 수와 동일하게 맞춤)
    const materialText = product.material || '-'; // Material이 없으면 '-' 표시
    
    // Heat No. 줄 수에 맞춰 Material 표시
    let materialY = yPosition;
    // 쉼표로 구분된 Material 값들
    const materialValues = materialText.split(',').map(m => m.trim()).filter(m => m.length > 0);
    const hasMultipleMaterials = materialValues.length > 1;
    
    // Heat No. 줄 수만큼 Material 표시
    for (let i = 0; i < heatNoLineCount; i++) {
      // Material 값이 여러 개면 순환 사용, 하나면 동일한 값 반복
      const materialValue = hasMultipleMaterials 
        ? (materialValues[i] || materialValues[materialValues.length - 1])
        : (materialValues[0] || materialText || '-');
      
      // Material 값을 한 줄로 표시 (Heat No. 각 줄마다 하나씩)
      doc.text(materialValue, colMaterial, materialY);
      materialY += 5;
    }
    
    // RESULT 열 (더 넓은 공간 확보)
    doc.text('GOOD', colResult, yPosition);
    
    // HEAT NO. 열 표시
    let heatNoY = yPosition;
    heatNoLines.forEach((line: string) => {
      renderKoreanText(doc, line, colHeatNo, heatNoY, 10);
      heatNoY += 5;
    });
    yPosition = Math.max(descY, Math.max(codeY, Math.max(materialY, Math.max(heatNoY, yPosition + 5)))) + 3;
  });

  // 기본 인증 문구 추가 (INSPECTION POINT 위에 배치)
  yPosition += 8;
  // 페이지 넘김 체크
  if (yPosition > pageHeight - 50) {
    doc.addPage();
    yPosition = margin + 10;
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
  }
  
  // INSPECTION POINT 제목
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('INSPECTION POINT', margin, yPosition);
  yPosition += 8;
  
  // INSPECTION POINT 항목들 (2열로 배치)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const inspectionPoints = [
    'Raw Material : Dimension, Chemical Composition',
    'Manufactured Products : Dimension, Go/No Gauge',
    'Cleaning : Cleaning Condition',
    'Marking : Code, Others',
    'Leak (Valves) : Air Test by Leak Tester',
    'Packaging : Labeling, Q\'ty'
  ];
  
  // 2열로 배치하기 위한 설정
  const columnWidth = (pageWidth - margin * 2 - 20) / 2; // 두 열 너비 (여백과 열 사이 간격 고려)
  const leftColumnX = margin + 5;
  const rightColumnX = leftColumnX + columnWidth + (8 * 0.7); // 열 사이 간격 30% 줄임 (8mm -> 5.6mm)
  const inspectionLineHeight = 6; // 각 항목 간격
  const startY = yPosition; // 시작 Y 위치 저장
  
  // 사인 컨텐츠를 우측 끝에 배치하기 위한 설정
  const approvalSectionX = pageWidth - margin; // 우측 끝 (margin만큼 여백)
  const signatureHeight = 12; // 사인 이미지 높이 공간
  const approvalStartY = startY; // INSPECTION POINT 시작 Y와 동일
  
  // 왼쪽 열 (0, 1, 2)
  inspectionPoints.slice(0, 3).forEach((point, index) => {
    doc.text(`- ${point}`, leftColumnX, startY + (index * inspectionLineHeight));
  });
  
  // 오른쪽 열 (3, 4, 5)
  inspectionPoints.slice(3, 6).forEach((point, index) => {
    doc.text(`- ${point}`, rightColumnX, startY + (index * inspectionLineHeight));
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
  yPosition = Math.max(startY + (3 * inspectionLineHeight), dateY + 8);

  // 표지 다음 페이지부터 각 제품의 INSPECTION CERTIFICATE 이미지를 순서대로 삽입
  console.log('[PDF 생성] Inspection Certificate 이미지 추가 시작, 제품 개수:', products.length);
  let failedImageCount = 0; // 실패한 이미지 개수 추적
  // 각 제품별, 파일별 검증 결과 저장
  const fileValidationResults: Array<{
    productIndex: number;
    productName: string;
    files: Array<{
      fileName: string;
      included: boolean;
      error?: string;
    }>;
  }> = [];
  
  for (let index = 0; index < products.length; index++) {
    const product = products[index];
    // 여러 파일 지원: inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
    const productWithCerts = product as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
    let inspectionCerts: CertificateAttachment[] = [];
    
    // inspectionCertificates 배열이 있으면 사용
    if (productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)) {
      inspectionCerts = productWithCerts.inspectionCertificates;
      console.log(`[PDF 생성] 제품 ${index + 1} inspectionCertificates 배열 발견:`, inspectionCerts.length, '개');
    } 
    // inspectionCertificates 배열이 없으면 inspectionCertificate 단일 객체를 배열로 변환
    else if (product.inspectionCertificate) {
      inspectionCerts = [product.inspectionCertificate];
      console.log(`[PDF 생성] 제품 ${index + 1} inspectionCertificate 단일 객체 발견`);
    } else {
      console.log(`[PDF 생성] 제품 ${index + 1} Inspection Certificate 없음`);
    }
    
    // 제품별 검증 결과 초기화
    const productValidationResult: {
      productIndex: number;
      productName: string;
      files: Array<{
        fileName: string;
        included: boolean;
        error?: string;
      }>;
    } = {
      productIndex: index + 1,
      productName: product.productName || `제품 ${index + 1}`,
      files: [],
    };
    
    // inspectionCerts 배열에서 유효한 파일만 필터링 (url 또는 base64가 있는 것)
    const beforeFilterCount = inspectionCerts.length;
    const filteredOutFiles: CertificateAttachment[] = [];
    inspectionCerts = inspectionCerts.filter(cert => {
      // URL, base64, 또는 storagePath가 있으면 포함
      const hasUrl = cert && cert.url && cert.url.trim().length > 0;
      const hasBase64 = cert && cert.base64 && cert.base64.trim().length > 0;
      const hasStoragePath = cert && cert.storagePath && cert.storagePath.trim().length > 0;
      if (hasUrl || hasBase64 || hasStoragePath) {
        return true;
      } else {
        filteredOutFiles.push(cert);
        return false;
      }
    });
    
    // URL과 base64가 모두 없는 파일들을 검증 결과에 추가
    filteredOutFiles.forEach(cert => {
      productValidationResult.files.push({
        fileName: cert.name || '이름 없음',
        included: false,
        error: 'URL과 base64가 모두 없습니다.',
      });
    });
    
    if (beforeFilterCount !== inspectionCerts.length) {
      console.warn(`[PDF 생성] 제품 ${index + 1} 필터링: ${beforeFilterCount}개 → ${inspectionCerts.length}개 (URL이 없는 파일 ${filteredOutFiles.length}개 제거됨)`);
    }
    
    console.log(`[PDF 생성] 제품 ${index + 1} 처리 중:`, {
      inspectionCertCount: inspectionCerts.length,
      certs: inspectionCerts.map((c: CertificateAttachment, idx: number) => ({ 
        index: idx + 1,
        name: c.name, 
        url: c.url,
        hasBase64: !!c.base64,
        base64Length: c.base64 ? c.base64.length : 0,
      })),
    });
    
    // 각 Inspection Certificate 파일을 순회하며 추가
    for (let certIndex = 0; certIndex < inspectionCerts.length; certIndex++) {
      const inspectionCert = inspectionCerts[certIndex];
      
      console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1}/${inspectionCerts.length} 처리 시작:`, {
        name: inspectionCert?.name,
        url: inspectionCert?.url,
        hasBase64: !!inspectionCert?.base64,
        storagePath: inspectionCert?.storagePath,
      });
      
      if (!inspectionCert) {
        console.warn(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1}이 null/undefined입니다. 건너뜀.`);
        continue;
      }
      
      // URL, base64, 또는 storagePath가 있어야 함
      const hasUrl = inspectionCert.url && inspectionCert.url.trim().length > 0;
      const hasBase64 = inspectionCert.base64 && inspectionCert.base64.trim().length > 0;
      const hasStoragePath = inspectionCert.storagePath && inspectionCert.storagePath.trim().length > 0;
      
      if (!hasUrl && !hasBase64 && !hasStoragePath) {
        console.warn(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1}의 URL, base64, storagePath가 모두 없습니다. 건너뜀.`);
        failedImageCount++;
        
        // 검증 결과: URL, base64, storagePath가 모두 없어서 포함되지 않음
        productValidationResult.files.push({
          fileName: inspectionCert.name || '이름 없음',
          included: false,
          error: 'URL, base64, storagePath가 모두 없습니다.',
        });
        
        continue;
      }
      
      // URL, base64, 또는 storagePath가 있으면 처리
      if (hasUrl || hasBase64 || hasStoragePath) {
      try {
        // Inspection Certificate는 이미지 파일이므로 바로 처리
        const fileType = inspectionCert.type || '';
        const fileName = inspectionCert.name.toLowerCase();
        
        console.log(`[PDF 생성] 제품 ${index + 1} 이미지 처리 시작:`, {
          fileType,
          fileName,
          url: inspectionCert.url,
        });
        
        // PNG 이미지 다운로드 및 base64 변환
        let base64ImageData: string = '';
        const imageFormat = 'PNG' as const;
        let img: HTMLImageElement | null = null;
        
        if (inspectionCert.base64) {
          // base64 데이터가 있으면 직접 사용
          console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 데이터 사용, 길이:`, inspectionCert.base64.length);
          try {
            const base64Data = inspectionCert.base64.includes(',') 
              ? inspectionCert.base64 
              : `data:image/png;base64,${inspectionCert.base64}`;
            
            const base64Img = new Image();
            base64Img.src = base64Data;
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('이미지 로드 타임아웃 (10초)')), 10000);
              base64Img.onload = () => {
                clearTimeout(timeout);
                console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 이미지 로드 완료:`, base64Img.width, 'x', base64Img.height);
                resolve();
              };
              base64Img.onerror = () => {
                clearTimeout(timeout);
                console.error(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 이미지 로드 실패, URL로 재시도`);
                reject(new Error('이미지 로드 실패'));
              };
            });
            img = base64Img;
            
            base64ImageData = base64Data.includes(',') 
              ? base64Data.split(',')[1] 
              : inspectionCert.base64;
            
            console.log(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64ImageData 준비 완료, 길이:`, base64ImageData.length);
          } catch (base64Error) {
            // base64 이미지 로드 실패 시 URL로 재시도
            console.warn(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64 이미지 로드 실패, URL로 재시도:`, base64Error);
            // base64ImageData를 null로 설정하여 URL 다운로드 로직으로 진행
            base64ImageData = '';
          }
        }
        
        // base64 데이터가 없거나 base64 로드가 실패한 경우 URL 또는 storagePath로 다운로드
        if (!base64ImageData || base64ImageData.length === 0) {
          // 이미지 다운로드
          console.log('[PDF 생성] 이미지 다운로드 시작, URL:', inspectionCert.url, 'storagePath:', inspectionCert.storagePath);
          
          let downloadSuccess = false;
          
          // 방법 1: URL이 있으면 Image 객체로 로드하고 Canvas로 base64 변환 (타임아웃 5초로 단축)
          if (inspectionCert.url && inspectionCert.url.trim().length > 0) {
            try {
              console.log('[PDF 생성] 기존 URL로 Image 객체 로드 시도:', inspectionCert.url);
              
              // Image 객체로 로드 (타임아웃 5초로 단축 - 빠른 실패)
              const imageUrl = await Promise.race([
                new Promise<string>((resolve, reject) => {
                  const testImg = new Image();
                  testImg.crossOrigin = 'anonymous';
                  testImg.onload = () => resolve(inspectionCert.url!);
                  testImg.onerror = () => reject(new Error('Image 로드 실패'));
                  testImg.src = inspectionCert.url;
                }),
                new Promise<string>((_, reject) => 
                  setTimeout(() => reject(new Error('Image 로드 타임아웃 (5초)')), 5000)
                )
              ]);
              
              // Image 객체 생성 및 로드
              const loadedImg = new Image();
              loadedImg.crossOrigin = 'anonymous';
              
              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('이미지 로드 타임아웃 (5초)')), 5000);
                loadedImg.onload = () => {
                  clearTimeout(timeout);
                  resolve();
                };
                loadedImg.onerror = () => {
                  clearTimeout(timeout);
                  reject(new Error('이미지 로드 실패'));
                };
                loadedImg.src = imageUrl;
              });
              
              // Canvas로 base64 변환
              const canvas = document.createElement('canvas');
              canvas.width = loadedImg.width;
              canvas.height = loadedImg.height;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                throw new Error('Canvas context를 가져올 수 없습니다.');
              }
              ctx.drawImage(loadedImg, 0, 0);
              
              base64ImageData = canvas.toDataURL('image/png').split(',')[1];
              img = loadedImg;
              downloadSuccess = true;
              console.log('[PDF 생성] Image 객체 로드 및 base64 변환 완료');
            } catch (imageError) {
              console.warn('[PDF 생성] Image 객체 로드 실패, storagePath로 재시도:', imageError);
              // Image 객체 로드 실패 시 storagePath로 바로 재시도 (fetch 생략)
            }
          }
          
          // 방법 2: URL 다운로드 실패했거나 URL이 없고 storagePath가 있으면 storagePath로 시도
          // 타임아웃 10초로 단축하여 빠른 실패
          if (!downloadSuccess && inspectionCert.storagePath && inspectionCert.storagePath.trim().length > 0) {
            try {
              console.log(`[PDF 생성] storagePath로 직접 다운로드 시도 (getBytes):`, inspectionCert.storagePath);
              const storageRef = ref(storage, inspectionCert.storagePath);
              
              // getBytes로 직접 다운로드 (타임아웃 10초로 단축 - 빠른 실패)
              const bytesResult = await Promise.race([
                getBytes(storageRef),
                new Promise<never>((_, reject) => 
                  setTimeout(() => reject(new Error('getBytes 타임아웃 (10초)')), 10000)
                )
              ]) as ArrayBuffer | Uint8Array;
              
              // 항상 Uint8Array로 변환
              const bytesArray: Uint8Array = bytesResult instanceof Uint8Array 
                ? bytesResult 
                : new Uint8Array(bytesResult);
              
              console.log('[PDF 생성] getBytes 다운로드 완료, 크기:', bytesArray.length);
              const blob = new Blob([bytesArray as BlobPart], { type: inspectionCert.type || 'image/png' });
              const blobUrl = URL.createObjectURL(blob);
              
              // Image 객체로 로드
              const loadedImg = new Image();
              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('이미지 로드 타임아웃 (5초)')), 5000);
                loadedImg.onload = () => {
                  clearTimeout(timeout);
                  resolve();
                };
                loadedImg.onerror = () => {
                  clearTimeout(timeout);
                  reject(new Error('이미지 로드 실패'));
                };
                loadedImg.src = blobUrl;
              });
              
              // Canvas로 base64 변환
              const canvas = document.createElement('canvas');
              canvas.width = loadedImg.width;
              canvas.height = loadedImg.height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(loadedImg, 0, 0);
                base64ImageData = canvas.toDataURL('image/png').split(',')[1];
                img = loadedImg;
                downloadSuccess = true;
                URL.revokeObjectURL(blobUrl);
                console.log('[PDF 생성] storagePath를 통한 다운로드 및 base64 변환 완료');
              }
            } catch (bytesError) {
              console.error(`[PDF 생성] getBytes 실패:`, bytesError);
              downloadSuccess = false;
              const errorMsg = bytesError instanceof Error ? bytesError.message : String(bytesError);
              console.warn(`[PDF 생성] storagePath 다운로드 실패, 파일 건너뜀: ${errorMsg}`);
              // 에러를 throw하지 않고 continue로 다음 파일로 넘어감
              failedImageCount++;
              productValidationResult.files.push({
                fileName: inspectionCert.name || '이름 없음',
                included: false,
                error: `storagePath 다운로드 실패: ${errorMsg}`,
              });
              continue;
            }
          }
          
          if (!downloadSuccess) {
            // 에러 발생 시 해당 이미지를 건너뛰고 계속 진행
            failedImageCount++;
            const errorMsg = `이미지 다운로드에 실패했습니다. storagePath와 URL 모두 사용할 수 없습니다.`;
            console.warn(`⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) ${errorMsg} (실패한 이미지: ${failedImageCount}개)`);
            
            // 검증 결과: 다운로드 실패
            productValidationResult.files.push({
              fileName: inspectionCert.name || '이름 없음',
              included: false,
              error: errorMsg,
            });
            
            // 에러를 throw하지 않고 continue로 다음 이미지로 넘어감
            continue;
          }
          
          // downloadSuccess가 true이고 base64ImageData와 img가 있는 경우에만 처리 진행
          if (!downloadSuccess || !base64ImageData || !img) {
            // 다운로드 실패 또는 base64ImageData/img가 없으면 다음 이미지로
            if (!downloadSuccess) {
              failedImageCount++;
              const errorMsg = `이미지 다운로드에 실패했습니다. storagePath와 URL 모두 사용할 수 없습니다.`;
              console.warn(`⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) ${errorMsg} (실패한 이미지: ${failedImageCount}개)`);
              
              // 검증 결과: 다운로드 실패
              productValidationResult.files.push({
                fileName: inspectionCert.name || '이름 없음',
                included: false,
                error: errorMsg,
              });
            } else if (!base64ImageData || !img) {
              failedImageCount++;
              console.warn(`⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) base64ImageData 또는 img가 없습니다. (실패한 이미지: ${failedImageCount}개)`);
              
              // 검증 결과: base64ImageData 또는 img가 없음
              productValidationResult.files.push({
                fileName: inspectionCert.name || '이름 없음',
                included: false,
                error: 'base64ImageData 또는 img가 없습니다.',
              });
            }
            continue;
          }
          
          console.log('[PDF 생성] base64ImageData 준비 완료, 길이:', base64ImageData.length, '이미지 크기:', img.width, 'x', img.height);
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
        
        // img가 null이면 에러
        if (!img) {
          console.error(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} img가 null입니다. 건너뜀.`);
          failedImageCount++;
          
          // 검증 결과: img가 null
          productValidationResult.files.push({
            fileName: inspectionCert.name || '이름 없음',
            included: false,
            error: '이미지 객체가 null입니다.',
          });
          
          continue;
        }
        
        // base64ImageData가 없으면 에러
        if (!base64ImageData || base64ImageData.length === 0) {
          console.error(`[PDF 생성] 제품 ${index + 1} 파일 ${certIndex + 1} base64ImageData가 없습니다. 건너뜀.`);
          failedImageCount++;
          
          // 검증 결과: base64ImageData가 없음
          productValidationResult.files.push({
            fileName: inspectionCert.name || '이름 없음',
            included: false,
            error: 'base64 이미지 데이터가 없습니다.',
          });
          
          continue;
        }
        
        // 이미지 크기 계산 (가로 여백 최소화)
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const availableWidth = pageWidth - (imageMargin * 2);
        const availableHeight = pageHeight - yPosition - imageMargin - 5;
        
        // 가로 사이즈를 페이지 너비에 맞추고, 세로는 비율에 맞게 조정
        const imgWidthMM = availableWidth;
        const imgHeightMM = (img.height / img.width) * availableWidth;
        
        // 세로가 페이지를 넘어가면 세로 기준으로 조정
        let finalWidthMM = imgWidthMM;
        let finalHeightMM = imgHeightMM;
        if (imgHeightMM > availableHeight) {
          finalHeightMM = availableHeight;
          finalWidthMM = (img.width / img.height) * availableHeight;
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
          imgWidth: img.width,
          imgHeight: img.height,
        });
        
        // 이미지 추가
        try {
          doc.addImage(base64ImageData, imageFormat, imgX, imgY, finalWidthMM, finalHeightMM);
          console.log(`[PDF 생성] ✅ 제품 ${index + 1} "${product.productName}" 파일 ${certIndex + 1}/${inspectionCerts.length} "${inspectionCert.name}" 이미지 추가 완료 - 페이지 번호: ${doc.getNumberOfPages()}, 제목: ${certTitle}`);
          
          // 검증 결과: 성공적으로 포함됨
          productValidationResult.files.push({
            fileName: inspectionCert.name || '이름 없음',
            included: true,
          });
        } catch (addImageError) {
          console.error(`[PDF 생성] doc.addImage 실패:`, addImageError);
          const errorMsg = addImageError instanceof Error ? addImageError.message : String(addImageError);
          
          // 검증 결과: PDF 추가 실패
          productValidationResult.files.push({
            fileName: inspectionCert.name || '이름 없음',
            included: false,
            error: `PDF에 이미지 추가 실패: ${errorMsg}`,
          });
          
          throw new Error(`이미지를 PDF에 추가하는데 실패했습니다: ${errorMsg}`);
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
        
        let errorMessage = '알 수 없는 오류';
        if (error instanceof Error) {
          errorInfo.errorMessage = error.message;
          errorInfo.errorName = error.name;
          errorInfo.errorStack = error.stack;
          errorMessage = error.message;
        } else if (error) {
          errorInfo.errorString = String(error);
          errorInfo.errorType = typeof error;
          errorInfo.errorKeys = Object.keys(error as Record<string, unknown>);
          errorMessage = String(error);
        } else {
          errorInfo.error = '알 수 없는 에러 (null/undefined)';
        }
        
        console.error(`제품 ${index + 1}의 이미지 로드 실패:`, error);
        console.error('에러 상세:', errorInfo);
        
        // 검증 결과: 이미지 로드 실패
        productValidationResult.files.push({
          fileName: inspectionCert.name || '이름 없음',
          included: false,
          error: errorMessage,
        });
        
        // 에러가 발생해도 다음 파일 계속 처리
        console.warn(`⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) 이미지를 PDF에 추가하지 못했습니다. (실패한 이미지: ${failedImageCount}개)`);
        // 에러가 발생해도 PDF 생성은 계속 진행 (이미지 없이)
        continue; // 이 파일은 건너뛰고 다음 파일로
      }
      } // if (hasUrl || hasBase64 || hasStoragePath) 블록 닫기
    } // for 루프 닫기
    
    if (inspectionCerts.length === 0) {
      console.log(`[PDF 생성] 제품 ${index + 1}에는 Inspection Certificate가 없습니다.`);
    }
    
    // 제품별 검증 결과를 전체 결과에 추가
    if (productValidationResult.files.length > 0 || inspectionCerts.length > 0) {
      fileValidationResults.push(productValidationResult);
    }
  }
  
  console.log(`[PDF 생성] 모든 이미지 처리 완료. 총 페이지 수: ${doc.getNumberOfPages()}, 실패한 이미지: ${failedImageCount}개`);
  console.log(`[PDF 생성] 파일 검증 결과:`, fileValidationResults.map((r: {
    productIndex: number;
    productName: string;
    files: Array<{
      fileName: string;
      included: boolean;
      error?: string;
    }>;
  }) => ({
    product: r.productName,
    totalFiles: r.files.length,
    includedFiles: r.files.filter((f: { fileName: string; included: boolean; error?: string }) => f.included).length,
    failedFiles: r.files.filter((f: { fileName: string; included: boolean; error?: string }) => !f.included).length,
    files: r.files.map((f: { fileName: string; included: boolean; error?: string }) => ({
      name: f.fileName,
      included: f.included,
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
    const { jsPDF: jsPDFFallback } = await import('jspdf');
    const fallbackDoc = new jsPDFFallback({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    fallbackDoc.text('PDF 생성 중 오류가 발생했습니다.', 20, 20);
    return { 
      blob: fallbackDoc.output('blob'), 
      failedImageCount,
      fileValidationResults: [], // 에러 발생 시 빈 배열 반환
    };
  }
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
  
  // S로 시작하는 부분 찾기 (Heat No.)
  const heatNoPart = parts.find(part => part.trim().toUpperCase().startsWith('S'));
  
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

// 모든 파일에서 Material과 Heat No. 수집하는 함수
// 모든 파일에서 Material과 Heat No. 수집하는 함수
// inspectionCertiFiles에는 File 객체와 CertificateAttachment 객체가 모두 포함될 수 있음
const collectMaterialAndHeatNo = (
  inspectionCertiFiles: File[],
  existingInspectionCertis: CertificateAttachment[] = []
): { material: string; heatNo: string } => {
  const materials: string[] = []; // Set 대신 배열 사용하여 파일 순서대로 수집
  const heatNos: string[] = [];
  
  // 새 파일 처리 (File 객체)
  for (const file of inspectionCertiFiles) {
    const fileName = file.name;
    const { material, heatNo } = extractMaterialAndHeatNo(fileName);
    if (material) {
      materials.push(material); // 중복 제거하지 않고 순서대로 추가
    }
    if (heatNo) {
      heatNos.push(heatNo);
    }
  }
  
  // 기존 파일 처리 (CertificateAttachment 객체)
  for (const cert of existingInspectionCertis) {
    const fileName = cert.name;
    const { material, heatNo } = extractMaterialAndHeatNo(fileName);
    if (material) {
      materials.push(material);
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

function MaterialTestCertificateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const certificateId = searchParams.get('id'); // 기존 성적서 요청 ID
  const copyFromId = searchParams.get('copyFrom'); // 복사할 성적서 ID
  const [isEditMode, setIsEditMode] = useState(false);
  const [isCopyMode, setIsCopyMode] = useState(false);
  const [loadingCertificate, setLoadingCertificate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // MATERIAL TEST CERTIFICATE 입력 항목
  const [formData, setFormData] = useState({
    certificateNo: '',        // CERTIFICATE NO.
    dateOfIssue: '',          // DATE OF ISSUE
    customer: '',             // CUSTOMER
    poNo: '',                 // PO NO.
    testResult: '',           // TEST RESULT
  });
  
  // 기존 데이터 저장 (변경사항 비교용)
  const [originalFormData, setOriginalFormData] = useState<typeof formData | null>(null);
  const [originalProducts, setOriginalProducts] = useState<typeof products | null>(null);

  // 소재/사이즈 타입 정의
  interface MaterialSize {
    materialType: 'Hexa' | 'Round';
    size: string;
  }

  // 제품 배열 (제품명, 제품코드, 수량, 히트번호, Material, Inspection Certi)
  // inspectionCertiFiles에는 새로 선택한 File 객체만 포함 (기존 파일은 existingInspectionCertis에 있음)
  const [products, setProducts] = useState<Array<{
    productName: string;
    productCode: string;
    quantity: string;
    heatNo: string;
    material: string;
    inspectionCertiFiles: File[]; // 새 파일만 포함
    existingInspectionCertis: CertificateAttachment[]; // 기존 파일만 포함 (MTC에 포함되지 않음)
    materialSizes?: MaterialSize[]; // 소재/사이즈 정보
  }>>([{ productName: '', productCode: '', quantity: '', heatNo: '', material: '', inspectionCertiFiles: [], existingInspectionCertis: [] }]);

  // 성적서 번호 자동 생성 함수
  const generateCertificateNo = async (): Promise<string> => {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const prefix = `SG-${dateStr}-`;
    
    try {
      // 모든 certificates를 가져와서 오늘 날짜로 시작하는 성적서 번호들을 찾기
      const certificatesRef = collection(db, 'certificates');
      const querySnapshot = await getDocs(certificatesRef);
      let maxNumber = 0;
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const certNo = data.materialTestCertificate?.certificateNo || '';
        if (certNo.startsWith(prefix)) {
          const numberPart = certNo.replace(prefix, '');
          const num = parseInt(numberPart, 10);
          if (!isNaN(num) && num > maxNumber) {
            maxNumber = num;
          }
        }
      });
      
      // 다음 번호 생성 (001부터 시작)
      const nextNumber = maxNumber + 1;
      return `${prefix}${String(nextNumber).padStart(3, '0')}`;
    } catch (error) {
      console.error('성적서 번호 생성 오류:', error);
      // 오류 발생 시 기본값 반환
      return `${prefix}001`;
    }
  };

  // 관리자 인증 확인
  useEffect(() => {
    if (!checkAdminAuth()) {
      router.push('/admin/login');
    }
  }, [router]);

  // 성적서 요청 정보 불러오기 (certificateId 또는 copyFromId 필수)
  useEffect(() => {
    const loadCertificateData = async () => {
      const targetId = copyFromId || certificateId;
      
      if (!targetId) {
        setError('성적서 요청 ID가 필요합니다. 성적서 목록에서 성적서 작성 버튼을 클릭해주세요.');
        setTimeout(() => {
          router.push('/admin/certificate');
        }, 3000);
        return;
      }

      setLoadingCertificate(true);
      try {
        const certDoc = await getDoc(doc(db, 'certificates', targetId));
        if (certDoc.exists()) {
          const data = certDoc.data();

          // 복사 모드인 경우 (certificateId가 없고 copyFromId만 있는 경우)
          if (copyFromId && !certificateId) {
            setIsCopyMode(true);
            // 기존 성적서 데이터를 복사하되, 새로운 성적서 번호 생성
            if (data.materialTestCertificate) {
              const mtc = data.materialTestCertificate;
              const newCertificateNo = await generateCertificateNo();
              setFormData({
                certificateNo: newCertificateNo,
                dateOfIssue: new Date().toISOString().split('T')[0], // 오늘 날짜로 설정
                customer: mtc.customer || '',
                poNo: mtc.poNo || '',
                testResult: mtc.testResult || '',
              });
              
              // 제품 데이터 로드 (products 배열이 있으면 사용, 없으면 기존 단일 제품 필드 사용)
              if (mtc.products && Array.isArray(mtc.products) && mtc.products.length > 0) {
                const loadedProducts = await Promise.all(mtc.products.map(async (p: CertificateProduct) => {
                  // inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
                  const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
                  const existingCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
                    ? productWithCerts.inspectionCertificates
                    : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
                  // 기존 파일들에서 Material과 Heat No. 수집
                  const { material, heatNo } = collectMaterialAndHeatNo([], existingCerts);
                  
                  // 제품명과 제품코드가 모두 있으면 소재/사이즈 조회
                  const productName = p.productName || '';
                  const productCode = p.productCode || '';
                  let materialSizes: MaterialSize[] | undefined = undefined;
                  if (productName.trim() && productCode.trim()) {
                    try {
                      materialSizes = await fetchProductMaterialSizes(productName, productCode);
                    } catch (error) {
                      console.error(`[로드] 제품 "${productName}" 소재/사이즈 조회 오류:`, error);
                      // 에러 발생 시 소재/사이즈 없이 진행
                    }
                  }
                  
                  return {
                    productName: productName,
                    productCode: productCode,
                    quantity: p.quantity?.toString() || '',
                    heatNo: heatNo || p.heatNo || '',
                    material: material || p.material || '',
                    inspectionCertiFiles: [],
                    existingInspectionCertis: existingCerts,
                    materialSizes: materialSizes,
                  };
                }));
                setProducts(loadedProducts);
              } else if (mtc.description || mtc.code || mtc.quantity) {
                // 기존 단일 제품 데이터를 배열로 변환
                // inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
                const mtcWithCerts = mtc as MaterialTestCertificate & { inspectionCertificates?: CertificateAttachment[] };
                const existingCerts = mtcWithCerts.inspectionCertificates && Array.isArray(mtcWithCerts.inspectionCertificates)
                  ? mtcWithCerts.inspectionCertificates
                  : (mtc.inspectionCertificate ? [mtc.inspectionCertificate] : []);
                const { material, heatNo } = collectMaterialAndHeatNo([], existingCerts);
                setProducts([{
                  productName: mtc.description || '',
                  productCode: mtc.code || '',
                  quantity: mtc.quantity?.toString() || '',
                  heatNo: heatNo || mtc.heatNo || '',
                  material: material || mtc.material || '',
                  inspectionCertiFiles: [],
                  existingInspectionCertis: existingCerts,
                }]);
              }
            } else {
              // 기존 성적서가 없으면 기본 정보로 자동 채움
              const newCertificateNo = await generateCertificateNo();
              setFormData({
                certificateNo: newCertificateNo,
                dateOfIssue: new Date().toISOString().split('T')[0],
                customer: data.customerName || '',
                poNo: data.orderNumber || '',
                testResult: '',
              });
              
              // 제품 데이터 로드 (products 배열이 있으면 사용, 없으면 기존 단일 제품 필드 사용)
              if (data.products && Array.isArray(data.products) && data.products.length > 0) {
                setProducts(data.products.map((p: CertificateProduct) => ({
                  productName: p.productName || '',
                  productCode: p.productCode || '',
                  quantity: p.quantity?.toString() || '',
                  heatNo: p.heatNo || '',
                  material: p.material || '',
                  inspectionCertiFiles: [],
                  existingInspectionCertis: p.inspectionCertificate ? [p.inspectionCertificate] : [],
                })));
              } else if (data.productName || data.productCode || data.quantity) {
                // 기존 단일 제품 데이터를 배열로 변환
                setProducts([{
                  productName: data.productName || '',
                  productCode: data.productCode || '',
                  quantity: data.quantity?.toString() || '',
                  heatNo: data.lotNumber || '',
                  material: '',
                  inspectionCertiFiles: [],
                  existingInspectionCertis: [],
                }]);
              }
            }
            setLoadingCertificate(false);
            return;
          }

          // 기존 MATERIAL TEST CERTIFICATE 내용이 있으면 불러오기 (수정 모드)
          if (data.materialTestCertificate) {
            setIsEditMode(true);
            setIsCopyMode(false); // 수정 모드에서는 복사 모드가 아님
            const mtc = data.materialTestCertificate;
            const loadedFormData = {
              certificateNo: mtc.certificateNo || '',
              dateOfIssue: mtc.dateOfIssue?.toDate().toISOString().split('T')[0] || '',
              customer: mtc.customer || '',
              poNo: mtc.poNo || '',
              testResult: mtc.testResult || '',
            };
            setFormData(loadedFormData);
            // 기존 데이터 저장 (변경사항 비교용)
            setOriginalFormData(loadedFormData);
            
            // 제품 데이터 로드 (products 배열이 있으면 사용, 없으면 기존 단일 제품 필드 사용)
            let loadedProducts: typeof products = [];
            if (mtc.products && Array.isArray(mtc.products) && mtc.products.length > 0) {
              // map 대신 for...of 루프 사용 (await를 사용하기 위해)
              for (const p of mtc.products) {
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
                    console.log(`[로드] 제품 "${p.productName || '이름 없음'}" 파일 ${idx + 1}:`, certData.name, certData.url ? 'URL 있음' : 'URL 없음');
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
                
                console.log(`[로드] 제품 "${p.productName || '이름 없음'}" 최종 기존 파일 개수:`, existingCerts.length);
                console.log(`[로드] 제품 "${p.productName || '이름 없음'}" 최종 기존 파일 목록:`, existingCerts.map((c, idx) => ({ 
                  index: idx + 1,
                  name: c.name, 
                  url: c.url,
                  urlLength: c.url ? c.url.length : 0,
                  hasUrl: !!c.url && c.url.trim().length > 0,
                  storagePath: c.storagePath,
                  storagePathLength: c.storagePath ? c.storagePath.length : 0,
                  hasStoragePath: !!c.storagePath && c.storagePath.trim().length > 0,
                  size: c.size,
                  type: c.type,
                })));
                
                // 기존 파일은 existingInspectionCertis로 분리 (PDF 생성 시 제외)
                console.log(`[로드] 제품 "${p.productName || '이름 없음'}" 기존 파일 ${existingCerts.length}개 로드 완료 (MTC에 포함되지 않음)`);
                
                // Material과 Heat No.는 빈칸으로 설정 (기존 파일에서 추출하지 않음, 새 파일 추가 시에만 추출)
                // 제품명과 제품코드가 모두 있으면 소재/사이즈 조회
                const productName = p.productName || '';
                const productCode = p.productCode || '';
                let materialSizes: MaterialSize[] | undefined = undefined;
                if (productName.trim() && productCode.trim()) {
                  try {
                    materialSizes = await fetchProductMaterialSizes(productName, productCode);
                  } catch (error) {
                    console.error(`[로드] 제품 "${productName}" 소재/사이즈 조회 오류:`, error);
                    // 에러 발생 시 소재/사이즈 없이 진행
                  }
                }
                
                loadedProducts.push({
                  productName: productName,
                  productCode: productCode,
                  quantity: p.quantity?.toString() || '',
                  heatNo: '', // 빈칸으로 설정
                  material: '', // 빈칸으로 설정
                  inspectionCertiFiles: [], // 새 파일만 포함
                  existingInspectionCertis: existingCerts, // 기존 파일은 별도로 분리 (MTC에 포함되지 않음)
                  materialSizes: materialSizes,
                });
              }
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
              
              console.log(`[로드] 단일 제품 "${mtc.description || '이름 없음'}" 기존 파일 개수:`, existingCerts.length);
              console.log(`[로드] 단일 제품 "${mtc.description || '이름 없음'}" 기존 파일:`, existingCerts.map(c => ({ name: c.name, url: c.url })));
              
              // 기존 파일을 base64로 미리 변환하여 새 파일처럼 처리 (미리보기/저장 속도 향상)
              console.log(`[로드] 단일 제품 "${mtc.description || '이름 없음'}" 기존 파일 ${existingCerts.length}개를 base64로 변환 시작`);
              
              // 기존 파일은 existingInspectionCertis로 분리 (PDF 생성 시 제외)
              console.log(`[로드] 단일 제품 "${mtc.description || '이름 없음'}" 기존 파일 ${existingCerts.length}개 로드 완료 (MTC에 포함되지 않음)`);
              
              // Material과 Heat No.는 빈칸으로 설정 (기존 파일에서 추출하지 않음, 새 파일 추가 시에만 추출)
              // 제품명과 제품코드가 모두 있으면 소재/사이즈 조회
              const productName = mtc.description || '';
              const productCode = mtc.code || '';
              let materialSizes: MaterialSize[] | undefined = undefined;
              if (productName.trim() && productCode.trim()) {
                try {
                  materialSizes = await fetchProductMaterialSizes(productName, productCode);
                } catch (error) {
                  console.error(`[로드] 제품 "${productName}" 소재/사이즈 조회 오류:`, error);
                  // 에러 발생 시 소재/사이즈 없이 진행
                }
              }
              
              loadedProducts = [{
                productName: productName,
                productCode: productCode,
                quantity: mtc.quantity?.toString() || '',
                heatNo: '', // 빈칸으로 설정
                material: '', // 빈칸으로 설정
                inspectionCertiFiles: [], // 새 파일만 포함
                existingInspectionCertis: existingCerts, // 기존 파일은 별도로 분리 (MTC에 포함되지 않음)
                materialSizes: materialSizes,
              }];
            }
            setProducts(loadedProducts);
            // 기존 제품 데이터 저장 (변경사항 비교용) - inspectionCertiFiles는 빈 배열이므로 비교에서 제외
            setOriginalProducts(loadedProducts.map(p => ({
              ...p,
              inspectionCertiFiles: [], // 비교 시에는 제외
            })));
          } else {
            // 기존 내용이 없으면 기본 정보로 자동 채움 및 성적서 번호 자동 생성
            const today = new Date().toISOString().split('T')[0];
            const autoCertificateNo = await generateCertificateNo();
            
            setFormData(prev => ({
              ...prev,
              certificateNo: autoCertificateNo,
              customer: data.customerName || '',
              poNo: data.orderNumber || '',
              dateOfIssue: today, // 오늘 날짜
            }));
            
            // 제품 데이터 로드 (products 배열이 있으면 사용, 없으면 기존 단일 제품 필드 사용)
            if (data.products && Array.isArray(data.products) && data.products.length > 0) {
              setProducts(data.products.map((p: CertificateProduct) => {
                const existingCerts = p.inspectionCertificate ? [p.inspectionCertificate] : [];
                // 기존 파일들에서 Material과 Heat No. 수집
                const { material, heatNo } = collectMaterialAndHeatNo([], existingCerts);
                return {
                  productName: p.productName || '',
                  productCode: p.productCode || '',
                  quantity: p.quantity?.toString() || '',
                  heatNo: heatNo || p.heatNo || '',
                  material: material || p.material || '',
                  inspectionCertiFiles: [],
                  existingInspectionCertis: existingCerts,
                };
              }));
            } else if (data.productName || data.productCode || data.quantity) {
              // 기존 단일 제품 데이터를 배열로 변환
              setProducts([{
                productName: data.productName || '',
                productCode: data.productCode || '',
                quantity: data.quantity?.toString() || '',
                heatNo: data.lotNumber || '',
                material: '',
                inspectionCertiFiles: [],
                existingInspectionCertis: [],
              }]);
            }
          }
        }
      } catch (error) {
        console.error('성적서 데이터 로드 오류:', error);
        setError('성적서 데이터를 불러오는데 실패했습니다.');
      } finally {
        setLoadingCertificate(false);
      }
    };

    if (copyFromId || certificateId) {
      loadCertificateData();
    }
  }, [certificateId, copyFromId, router, fetchProductMaterialSizes]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    // certificateNo는 수정 불가 (시스템 자동 생성)
    if (name === 'certificateNo') {
      return;
    }
    // 영문 입력 필드는 자동으로 대문자로 변환
    const uppercaseFields = ['customer', 'poNo'];
    const processedValue = uppercaseFields.includes(name) ? value.toUpperCase() : value;
    setFormData(prev => ({
      ...prev,
      [name]: processedValue,
    }));
    
    // 해당 필드의 에러 초기화
    if (fieldErrors[name]) {
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  // 제품별 소재/사이즈 조회 함수
  const fetchProductMaterialSizes = useCallback(async (productName: string, productCode: string): Promise<MaterialSize[] | undefined> => {
    if (!productName.trim() || !productCode.trim()) {
      return undefined;
    }
    
    try {
      const q = query(
        collection(db, 'productMaterialSizes'),
        where('productName', '==', productName.trim().toUpperCase()),
        where('productCode', '==', productCode.trim().toUpperCase())
      );
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        return undefined;
      }
      
      const docData = querySnapshot.docs[0].data();
      const materials = (docData.materials || []).map((m: { id?: string; materialType: string; size: string }) => ({
        materialType: m.materialType as 'Hexa' | 'Round',
        size: m.size || '',
      }));
      
      return materials.length > 0 ? materials : undefined;
    } catch (error) {
      console.error('소재/사이즈 조회 오류:', error);
      return undefined;
    }
  }, []);

  // 제품 필드 변경 핸들러
  const handleProductChange = (index: number, field: 'productName' | 'productCode' | 'quantity' | 'heatNo' | 'material', value: string) => {
    // 제품명, 제품코드, 히트번호, Material은 대문자로 변환
    const uppercaseFields = ['productName', 'productCode', 'heatNo', 'material'];
    const processedValue = uppercaseFields.includes(field) ? value.toUpperCase() : value;
    
    setProducts(prev => {
      const newProducts = [...prev];
      const currentProduct = newProducts[index];
      const updatedProduct = { ...currentProduct, [field]: processedValue };
      newProducts[index] = updatedProduct;
      
      // 제품명 또는 제품코드가 변경된 경우 소재/사이즈 조회 (비동기로 처리)
      if (field === 'productName' || field === 'productCode') {
        const productName = field === 'productName' ? processedValue : updatedProduct.productName;
        const productCode = field === 'productCode' ? processedValue : updatedProduct.productCode;
        
        if (productName.trim() && productCode.trim()) {
          // 비동기로 소재/사이즈 조회 (상태 업데이트는 즉시, 조회는 나중에)
          fetchProductMaterialSizes(productName, productCode).then(materialSizes => {
            setProducts(prevProducts => {
              const updatedProducts = [...prevProducts];
              if (updatedProducts[index]) {
                updatedProducts[index] = { ...updatedProducts[index], materialSizes: materialSizes || undefined };
              }
              return updatedProducts;
            });
          }).catch(error => {
            console.error('소재/사이즈 조회 오류:', error);
          });
        } else {
          // 제품명 또는 제품코드가 비어있으면 소재/사이즈 정보 제거
          updatedProduct.materialSizes = undefined;
        }
      }
      
      return newProducts;
    });
    
    // 해당 필드의 에러 초기화
    if (fieldErrors[`${field}-${index}`]) {
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[`${field}-${index}`];
        return newErrors;
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
        inspectionCertiFiles: [], // 새 파일은 복사하지 않음
        existingInspectionCertis: [], // 기존 파일도 복사하지 않음
        materialSizes: undefined, // 소재/사이즈는 복사하지 않음 (제품명/코드 입력 시 자동 조회)
      };
      return [...prev, newProduct];
    });
  };

  // 제품 삭제
  const handleRemoveProduct = (index: number) => {
    if (products.length > 1) {
      const productName = products[index]?.productName || `제품 ${index + 1}`;
      if (confirm(`"${productName}" 제품을 삭제하시겠습니까?`)) {
        setProducts(prev => prev.filter((_, i) => i !== index));
      }
    }
  };


  // 제품별 Inspection Certi 파일 추가
  const handleProductInspectionCertiAdd = (index: number, files: FileList | null) => {
    if (!files || files.length === 0) {
      console.log('[파일 추가] 파일이 없습니다.');
      return;
    }
    
    console.log('[파일 추가] 파일 선택됨:', Array.from(files).map(f => f.name));
    
    setProducts(prev => {
      const newProducts = [...prev];
      const newFiles = Array.from(files);
      const currentProduct = newProducts[index];
      
      console.log('[파일 추가] 현재 제품의 새 파일:', currentProduct.inspectionCertiFiles.map(f => f.name));
      console.log('[파일 추가] 현재 제품의 새 파일:', currentProduct.inspectionCertiFiles.map(f => f.name));
      
      // 새 파일에서만 Material과 Heat No. 수집 (기존 파일 제외)
      const updatedFiles = [...currentProduct.inspectionCertiFiles, ...newFiles];
      const { material, heatNo } = collectMaterialAndHeatNo(updatedFiles, []); // 기존 파일 제외
      
      // 한 번에 모든 업데이트 적용
      const updatedProduct = {
        ...currentProduct,
        inspectionCertiFiles: updatedFiles,
        material,
        heatNo,
      };
      
      console.log('[파일 추가] 업데이트된 제품의 파일:', updatedProduct.inspectionCertiFiles.map(f => f.name));
      console.log('[파일 추가] Material:', material, 'Heat No.:', heatNo);
      
      newProducts[index] = updatedProduct;
      
      return newProducts;
    });
  };

  // 제품별 새로 선택한 Inspection Certi 파일 삭제
  const handleDeleteInspectionCertiFile = (productIndex: number, fileIndex: number) => {
    setProducts(prev => {
      const newProducts = [...prev];
      const currentProduct = newProducts[productIndex];
      const updatedFiles = currentProduct.inspectionCertiFiles.filter((_, i) => i !== fileIndex);
      
      // 남은 파일들에서 Material과 Heat No. 다시 수집 (기존 파일 제외)
      const { material, heatNo } = collectMaterialAndHeatNo(updatedFiles, []); // 기존 파일 제외
      
      newProducts[productIndex] = {
        ...currentProduct,
        inspectionCertiFiles: updatedFiles,
        material,
        heatNo,
      };
      return newProducts;
    });
  };



  const validateForm = () => {
    const errors: Record<string, string> = {};

    // CERTIFICATE NO. 필수 (1순위)
    if (!formData.certificateNo.trim()) {
      errors.certificateNo = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      // 브라우저 기본 툴팁 표시
      const element = document.getElementById('certificateNo');
      if (element) {
        (element as HTMLInputElement).focus();
        (element as HTMLInputElement).reportValidity();
      }
      return false;
    }

    // DATE OF ISSUE 필수 (2순위)
    if (!formData.dateOfIssue.trim()) {
      errors.dateOfIssue = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      // 브라우저 기본 툴팁 표시
      const element = document.getElementById('dateOfIssue');
      if (element) {
        (element as HTMLInputElement).focus();
        (element as HTMLInputElement).reportValidity();
      }
      return false;
    }

    // CUSTOMER 필수 (3순위)
    if (!formData.customer.trim()) {
      errors.customer = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      // 브라우저 기본 툴팁 표시
      const element = document.getElementById('customer');
      if (element) {
        (element as HTMLInputElement).focus();
        (element as HTMLInputElement).reportValidity();
      }
      return false;
    }

    // 제품 정보 필수 검증 (4순위)
    if (!products || products.length === 0) {
      errors.products = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      return false;
    }
    
    // 각 제품의 필수 필드 검증
    let hasError = false;
    let firstErrorField: string | null = null;
    products.forEach((product, index) => {
      if (!product.productName.trim()) {
        errors[`productName-${index}`] = '이 입력란을 작성하세요.';
        if (!firstErrorField) firstErrorField = `productName-${index}`;
        hasError = true;
      }
      if (!product.productCode.trim()) {
        errors[`productCode-${index}`] = '이 입력란을 작성하세요.';
        if (!firstErrorField) firstErrorField = `productCode-${index}`;
        hasError = true;
      }
      if (!product.quantity.trim()) {
        errors[`quantity-${index}`] = '이 입력란을 작성하세요.';
        if (!firstErrorField) firstErrorField = `quantity-${index}`;
        hasError = true;
      }
    });
    
    if (hasError) {
      setFieldErrors(errors);
      // 첫 번째 에러 필드에 브라우저 기본 툴팁 표시
      if (firstErrorField) {
        setTimeout(() => {
          const element = document.getElementById(firstErrorField!);
          if (element) {
            (element as HTMLInputElement).focus();
            (element as HTMLInputElement).reportValidity();
          }
        }, 100);
      }
      return false;
    }

    setFieldErrors({});
    return true;
  };

  // 변경사항 확인 함수 (현재 사용하지 않음 - 수정 모드에서 항상 새 PDF 생성)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const hasChanges = (): boolean => {
    try {
      // 수정 모드가 아니거나 기존 데이터가 없으면 변경사항 있음
      if (!isEditMode || !originalFormData || !originalProducts) {
        console.log('[변경사항 확인] 수정 모드가 아니거나 기존 데이터 없음:', {
          isEditMode,
          hasOriginalFormData: !!originalFormData,
          hasOriginalProducts: !!originalProducts,
        });
        return true;
      }

      // FormData 비교
      if (
        formData.certificateNo.trim() !== originalFormData.certificateNo.trim() ||
        formData.dateOfIssue !== originalFormData.dateOfIssue ||
        formData.customer.trim() !== originalFormData.customer.trim() ||
        formData.poNo.trim() !== originalFormData.poNo.trim() ||
        formData.testResult.trim() !== originalFormData.testResult.trim()
      ) {
        console.log('[변경사항 확인] FormData 변경됨');
        return true;
      }

      // 제품 개수 비교
      const currentValidProducts = products.filter(p => 
        p.productName.trim() || p.productCode.trim() || p.quantity.trim()
      );
      const originalValidProducts = originalProducts.filter(p => 
        p.productName.trim() || p.productCode.trim() || p.quantity.trim()
      );

      if (currentValidProducts.length !== originalValidProducts.length) {
        console.log('[변경사항 확인] 제품 개수 변경됨:', {
          current: currentValidProducts.length,
          original: originalValidProducts.length,
        });
        return true;
      }

      // 각 제품 비교
      for (let i = 0; i < currentValidProducts.length; i++) {
        const current = currentValidProducts[i];
        const original = originalValidProducts[i];

        if (!original) {
          console.log(`[변경사항 확인] 제품 ${i + 1}: 원본 데이터 없음`);
          return true;
        }

        if (
          current.productName.trim() !== original.productName.trim() ||
          current.productCode.trim() !== original.productCode.trim() ||
          current.quantity.trim() !== original.quantity.trim() ||
          current.heatNo.trim() !== original.heatNo.trim() ||
          current.material.trim() !== original.material.trim()
        ) {
          console.log(`[변경사항 확인] 제품 ${i + 1} 내용 변경됨`);
          return true;
        }

        // Inspection Certificate 파일 개수 비교
        const currentCertCount = current.inspectionCertiFiles?.length || 0;
        const originalCertCount = original.inspectionCertiFiles?.length || 0;
        
        if (currentCertCount !== originalCertCount) {
          console.log(`[변경사항 확인] 제품 ${i + 1} Inspection Cert 파일 개수 변경됨:`, {
            current: currentCertCount,
            original: originalCertCount,
          });
          return true;
        }

        // 파일이 추가되었는지 확인
        if (current.inspectionCertiFiles && current.inspectionCertiFiles.length > 0) {
          console.log(`[변경사항 확인] 제품 ${i + 1} 파일 추가됨`);
          return true;
        }

        // 파일이 삭제되었는지 확인 (이름으로 비교)
        const currentCertNames = (current.inspectionCertiFiles || [])
          .map(item => item.name)
          .filter(name => name.length > 0)
          .sort();
        const originalCertNames = (original.inspectionCertiFiles || [])
          .map(item => item.name)
          .filter(name => name.length > 0)
          .sort();
        
        if (currentCertNames.length !== originalCertNames.length) {
          console.log(`[변경사항 확인] 제품 ${i + 1} 파일 이름 개수 변경됨`);
          return true;
        }
        
        // 각 파일 이름 비교 (안정성을 위해 개별 비교)
        for (let j = 0; j < currentCertNames.length; j++) {
          if (currentCertNames[j] !== originalCertNames[j]) {
            console.log(`[변경사항 확인] 제품 ${i + 1} 파일 이름 변경됨:`, {
              current: currentCertNames[j],
              original: originalCertNames[j],
            });
            return true;
          }
        }
      }

      console.log('[변경사항 확인] 변경사항 없음');
      return false; // 변경사항 없음
    } catch (error) {
      console.error('[변경사항 확인] 에러 발생:', error);
      // 에러 발생 시 안전하게 변경사항 있음으로 처리
      return true;
    }
  };

  const handleSave = async () => {
    // 복사 모드인 경우 새로운 성적서 요청을 생성해야 함
    if (isCopyMode && !copyFromId) {
      setError('복사할 성적서 ID가 없습니다.');
      return;
    }

    // 일반 모드인 경우 certificateId가 필요
    if (!isCopyMode && !certificateId) {
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
      // 제품별 Inspection Certi 업로드 및 제품 데이터 준비
      const productsData: CertificateProduct[] = [];
      
      console.log(`[저장] 시작 - 총 ${products.length}개 제품 처리 예정`);
      
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        
        // 디버깅: 각 제품의 초기 상태 확인
        console.log(`[저장] 제품 ${i + 1} "${product.productName}" 처리 시작:`, {
          totalFiles: product.inspectionCertiFiles?.length || 0,
        });
        
        if (!product.productName.trim() && !product.productCode.trim() && !product.quantity.trim()) {
          console.log(`[저장] 제품 ${i + 1} 빈 제품으로 제외됨`);
          continue; // 빈 제품은 제외
        }

        const productData: CertificateProduct = {
          productName: product.productName.trim(),
          productCode: product.productCode.trim() || undefined,
          quantity: product.quantity.trim() ? parseInt(product.quantity, 10) : undefined,
          heatNo: product.heatNo.trim() || undefined,
          material: product.material.trim() || undefined,
        };

        // 제품별 Inspection Certi 파일 처리
        // Firestore 저장용: 새 파일만 저장 (기존 파일 제외 - 과거 이력 제거)
        // PDF 생성용: 새 파일만 포함
        const inspectionCertificatesForFirestore: CertificateAttachment[] = [];
        const inspectionCertificatesForPDF: CertificateAttachment[] = [];
        
        // 기존 파일은 Firestore에 저장하지 않음 (과거 이력 제거, 새 파일만 저장)
        
        // 새 파일은 병렬로 업로드 및 base64 변환 (속도 향상)
        if (product.inspectionCertiFiles && product.inspectionCertiFiles.length > 0) {
          const newFiles = product.inspectionCertiFiles.filter(item => item instanceof File) as File[];
          if (newFiles.length > 0) {
            // 업로드와 base64 변환을 병렬로 처리
            const uploadPromises = newFiles.map(async (file) => {
              try {
                const timestamp = Date.now();
                const randomId = Math.random().toString(36).substring(2, 15);
                const fileName = `inspection_certi_${certificateId || 'temp'}_${timestamp}_${randomId}_${file.name}`;
                const filePath = `certificates/${certificateId || 'temp'}/inspection_certi/${fileName}`;
                const storageRef = ref(storage, filePath);
                
                // 업로드와 base64 변환을 동시에 시작
                const [downloadURL, base64Data] = await Promise.all([
                  uploadBytes(storageRef, file).then(() => getDownloadURL(storageRef)),
                  new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      if (typeof reader.result === 'string') {
                        resolve(reader.result);
                      } else {
                        reject(new Error('FileReader result is not a string'));
                      }
                    };
                    reader.onerror = () => reject(new Error('FileReader error'));
                    reader.readAsDataURL(file);
                  })
                ]);
                
                return {
                  name: file.name,
                  url: downloadURL,
                  storagePath: filePath,
                  size: file.size,
                  type: file.type,
                  uploadedAt: new Date(),
                  uploadedBy: 'admin',
                  base64: base64Data,
                } as CertificateAttachment;
              } catch (fileError) {
                console.error(`[저장] 제품 ${i + 1} 파일 "${file.name}" 업로드 오류:`, fileError);
                throw fileError;
              }
            });
            
            // 모든 파일 업로드를 병렬로 대기
            const uploadResults = await Promise.all(uploadPromises);
            // Firestore 저장용: 새 파일 추가
            inspectionCertificatesForFirestore.push(...uploadResults);
            // PDF 생성용: 새 파일만 추가 (base64 포함)
            inspectionCertificatesForPDF.push(...uploadResults);
            console.log(`[저장] 제품 ${i + 1} 새 파일 ${newFiles.length}개 병렬 업로드 완료`);
          }
        }
        
        console.log(`[저장] 제품 ${i + 1} 파일 처리 완료: 기존 파일 ${product.existingInspectionCertis?.length || 0}개 (제외), 새 파일 ${product.inspectionCertiFiles?.length || 0}개, Firestore 저장용 ${inspectionCertificatesForFirestore.length}개 (새 파일만), PDF 생성용 ${inspectionCertificatesForPDF.length}개`);
        
        // Firestore 저장용 데이터 (기존 파일 + 새 파일)
        const productDataWithCerts = productData as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        productDataWithCerts.inspectionCertificates = inspectionCertificatesForFirestore.length > 0 ? [...inspectionCertificatesForFirestore] : [];
        
        // 첫 번째 파일을 inspectionCertificate에 저장 (하위 호환성)
        if (inspectionCertificatesForFirestore.length > 0) {
          productData.inspectionCertificate = inspectionCertificatesForFirestore[0];
        } else {
          productData.inspectionCertificate = undefined;
        }

        productsData.push(productDataWithCerts);
        
        // 디버깅: 각 제품의 파일 개수 확인
        console.log(`[저장] 제품 ${i + 1} "${product.productName}" 처리 완료:`, {
          inspectionCertificatesCount: inspectionCertificatesForFirestore.length,
          totalFiles: product.inspectionCertiFiles?.length || 0,
        });
      }

      // 디버깅: 전체 productsData 확인
      const totalFiles = productsData.reduce((sum, p) => {
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

      // 수정 모드인 경우 기존 성적서의 createdAt과 createdBy 유지
      let createdAt = new Date();
      let createdBy = 'admin';
      
      if (certificateId && !isCopyMode) {
        // 기존 성적서 정보 로드
        const existingDoc = await getDoc(doc(db, 'certificates', certificateId));
        if (existingDoc.exists()) {
          const existingData = existingDoc.data();
          if (existingData.materialTestCertificate) {
            createdAt = existingData.materialTestCertificate.createdAt?.toDate() || new Date();
            createdBy = existingData.materialTestCertificate.createdBy || 'admin';
          }
        }
      }

      const materialTestCertificate: MaterialTestCertificate = {
        certificateNo: formData.certificateNo.trim(),
        dateOfIssue: Timestamp.fromDate(new Date(formData.dateOfIssue)).toDate(),
        customer: formData.customer.trim(),
        poNo: formData.poNo.trim() || '',
        products: productsData,
        testResult: formData.testResult.trim(),
        createdAt: createdAt,
        updatedAt: new Date(),
        createdBy: createdBy,
      };

      // PDF 생성용 데이터 준비 (새 파일만 포함, 기존 파일 제외)
      const productsDataForPDF: CertificateProduct[] = [];
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        if (!product.productName.trim() && !product.productCode.trim() && !product.quantity.trim()) {
          continue;
        }
        
        const productDataForPDF: CertificateProduct = {
          productName: product.productName.trim(),
          productCode: product.productCode.trim() || undefined,
          quantity: product.quantity.trim() ? parseInt(product.quantity, 10) : undefined,
          heatNo: product.heatNo.trim() || undefined,
          material: product.material.trim() || undefined,
        };
        
        // 새 파일만 PDF 생성에 포함 (products 배열에서 직접 추출)
        const newFiles = product.inspectionCertiFiles.filter(item => item instanceof File) as File[];
        if (newFiles.length > 0) {
          // productsData에서 해당 제품의 새 파일만 찾기 (base64가 있는 것만)
          const productDataWithCerts = productsData[i] as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          const newFileCerts = (productDataWithCerts.inspectionCertificates || []).filter(cert => {
            // 새 파일 이름과 일치하고 base64가 있는 것만
            return cert.base64 && cert.base64.trim().length > 0 && 
                   newFiles.some(file => file.name === cert.name);
          });
          
          if (newFileCerts.length > 0) {
            productDataForPDF.inspectionCertificate = newFileCerts[0];
            (productDataForPDF as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] }).inspectionCertificates = newFileCerts;
          }
        }
        
        productsDataForPDF.push(productDataForPDF);
      }
      
      // PDF 생성 (수정 모드에서도 항상 새로 생성)
      let pdfBlob: Blob | null = null;
      let failedImageCount = 0;
      let totalExpectedFiles = 0; // PDF 생성 전 예상 파일 개수 (외부에서도 사용)
      
      // 항상 새 PDF 생성
      try {
        // PDF 생성 전 예상 파일 개수 확인 (새 파일만)
        const expectedFileCounts: Array<{ productIndex: number; productName: string; fileCount: number }> = [];
        productsDataForPDF.forEach((p, idx) => {
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
        console.log(`[저장] PDF 생성 전 예상 파일 개수 (새 파일만): 총 ${totalExpectedFiles}개 (${expectedFileCounts.length}개 제품)`);
        
        // PDF 생성 시도 (타임아웃 120초) - 새 파일만 포함
        const pdfResult = await Promise.race([
          generatePDFBlobWithProducts(formData, productsDataForPDF),
          new Promise<{ 
            blob: Blob; 
            failedImageCount: number;
            fileValidationResults: Array<{
              productIndex: number;
              productName: string;
              files: Array<{
                fileName: string;
                included: boolean;
                error?: string;
              }>;
            }>;
          }>((_, reject) => {
            setTimeout(() => {
              reject(new Error('PDF 생성 타임아웃 (120초)'));
            }, 120000);
          })
        ]);
        
        if (!pdfResult) {
          throw new Error('PDF 생성 결과를 받을 수 없습니다.');
        }
        
        pdfBlob = pdfResult.blob;
        failedImageCount = pdfResult.failedImageCount;
        
        // PDF 생성 후 검증: Inspection Certificate 파일이 모두 포함되었는지 확인
        if (!pdfResult) {
          setError('PDF 생성 결과를 확인할 수 없습니다. 저장이 중단되었습니다.');
          setSaving(false);
          return; // 저장 중단
        }
        
        const totalSuccessFiles = totalExpectedFiles - failedImageCount;
        console.log(`[저장] PDF 생성 후 검증: 예상 ${totalExpectedFiles}개, 성공 ${totalSuccessFiles}개, 실패 ${failedImageCount}개`);
        
        // 실패한 파일이 있으면 상세 정보 수집
        if (failedImageCount > 0) {
          let detailedErrorMessage = `❌ ${failedImageCount}개의 Inspection Certificate 파일을 PDF에 포함하지 못했습니다. 저장이 중단되었습니다.\n\n`;
          detailedErrorMessage += `실패한 파일 상세 정보:\n\n`;
          
          // fileValidationResults에서 실패한 파일 정보 추출
          const failedFilesDetails: Array<{ productName: string; fileName: string; error?: string }> = [];
          pdfResult.fileValidationResults.forEach(productResult => {
            productResult.files.forEach(file => {
              if (!file.included) {
                failedFilesDetails.push({
                  productName: productResult.productName,
                  fileName: file.fileName,
                  error: file.error,
                });
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
          
          setError(detailedErrorMessage);
          setSaving(false);
          return; // 저장 중단
        } else if (totalExpectedFiles > 0) {
          console.log(`[저장] ✅ 모든 Inspection Certificate 파일(${totalExpectedFiles}개)이 PDF에 성공적으로 포함되었습니다.`);
          // 성공 메시지는 저장 완료 후 표시
        } else {
          console.log(`[저장] ℹ️ Inspection Certificate 파일이 없습니다.`);
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
      const fileName = `MATERIAL_TEST_CERTIFICATE_${formData.certificateNo || 'CERT'}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      let targetCertificateId: string;
      
      // 수정 모드인 경우 (certificateId가 있으면 기존 성적서 업데이트)
      if (certificateId) {
        targetCertificateId = certificateId;
      } 
      // 복사 모드인 경우 (certificateId가 없고 copyFromId만 있으면 새로운 성적서 생성)
      else if (isCopyMode && copyFromId) {
        const sourceDoc = await getDoc(doc(db, 'certificates', copyFromId));
        if (!sourceDoc.exists()) {
          setError('원본 성적서를 찾을 수 없습니다.');
          setSaving(false);
          return;
        }
        
        const sourceData = sourceDoc.data();
        // 원본 성적서 요청의 기본 정보를 복사하여 새로운 요청 생성
        const newCertificateData: Record<string, unknown> = {
          userId: sourceData.userId || 'admin',
          userName: sourceData.userName || '관리자',
          userEmail: sourceData.userEmail || 'admin@sglok.com',
          customerName: formData.customer.trim(),
          orderNumber: formData.poNo.trim() || null,
          products: productsData,
          certificateType: sourceData.certificateType || 'quality',
          requestDate: Timestamp.now(),
          requestedCompletionDate: sourceData.requestedCompletionDate || Timestamp.now(),
          status: 'completed', // 바로 완료 상태로 설정
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: 'admin',
        };
        
        // memo 복사
        if (sourceData.memo) {
          newCertificateData.memo = sourceData.memo;
        }
        
        // 첨부 파일 복사
        if (sourceData.attachments) {
          newCertificateData.attachments = sourceData.attachments;
        }
        
        const newDocRef = await addDoc(collection(db, 'certificates'), newCertificateData);
        targetCertificateId = newDocRef.id;
      } else {
        // certificateId도 없고 copyFromId도 없으면 에러
        setError('성적서 ID가 없습니다.');
        setSaving(false);
        return;
      }
      
      // pdfBlob이 null이면 에러
      if (!pdfBlob) {
        setError('PDF 생성에 실패했습니다. 다시 시도해주세요.');
        setSaving(false);
        return;
      }

      // 새 PDF 업로드 (수정 페이지와 동일한 파일명 규칙 사용)
      // CERTIFICATE NO.를 기반으로 고정된 파일명 사용 (같은 성적서는 항상 같은 파일명)
      const storageFileName = `certificate_${formData.certificateNo.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      const filePath = `certificates/${targetCertificateId}/${storageFileName}`;
      
      console.log('[저장] PDF 저장 경로:', filePath);
      const storageRef = ref(storage, filePath);
      
      try {
        await uploadBytes(storageRef, pdfBlob);
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
      
      // certificateFile 정보 생성 (storagePath 포함 - 삭제 시 사용)
      const certificateFile: CertificateAttachment = {
        name: fileName,
        url: downloadURL,
        storagePath: filePath, // storagePath 저장 (삭제 시 사용)
        size: pdfBlob.size,
        type: 'application/pdf',
        uploadedAt: new Date(),
        uploadedBy: 'admin',
      };

      // Firestore에 저장할 때는 Timestamp로 변환하고 undefined 필드 제거
      const materialTestCertificateForFirestore: Record<string, unknown> = {
        certificateNo: materialTestCertificate.certificateNo,
        dateOfIssue: Timestamp.fromDate(materialTestCertificate.dateOfIssue),
        customer: materialTestCertificate.customer,
        poNo: materialTestCertificate.poNo,
        products: productsData.map(p => {
          const productForFirestore: Record<string, unknown> = {
            productName: p.productName,
            productCode: p.productCode || null,
            quantity: p.quantity || null,
            heatNo: p.heatNo || null,
          };
          
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
        storagePath: certificateFile.storagePath || null, // storagePath 저장 (삭제 시 사용)
        uploadedAt: Timestamp.fromDate(certificateFile.uploadedAt),
      };

      await updateDoc(doc(db, 'certificates', targetCertificateId), {
        materialTestCertificate: materialTestCertificateForFirestore,
        certificateFile: certificateFileForFirestore,
        status: 'completed',
        completedAt: Timestamp.now(),
        completedBy: 'admin',
        updatedAt: Timestamp.now(),
        updatedBy: 'admin',
      });

      // 수정 모드인지 복사 모드인지 확인
      const isActuallyCopyMode = !certificateId && isCopyMode && copyFromId;
      let successMessage = isActuallyCopyMode 
        ? '✅ 기존 성적서를 복사하여 새로운 성적서가 생성되었고 PDF 파일이 업로드되었습니다.'
        : isEditMode
        ? '✅ 성적서 내용이 수정되었고 PDF 파일이 업로드되었습니다.'
        : '✅ 성적서 내용이 저장되었고 PDF 파일이 업로드되었습니다.';
      
      // 성공 메시지에 포함된 파일 개수 표시 (PDF 생성 검증이 이미 완료되었으므로 모든 파일이 포함됨)
      if (totalExpectedFiles > 0) {
        successMessage += `\n모든 Inspection Certificate 파일(${totalExpectedFiles}개)이 PDF에 성공적으로 포함되었습니다.`;
      }
      
      setSuccess(successMessage);
      setIsEditMode(true);
      
      // 저장 후 상태 업데이트: 새로 업로드한 파일을 existingInspectionCertis로 이동
      setProducts(prev => prev.map((product, index) => {
        const productData = productsData[index];
        if (!productData) return product;
        
        // 저장된 inspectionCertificates 배열 가져오기
        const productWithCerts = productData as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        const savedCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
          ? productWithCerts.inspectionCertificates
          : (productData.inspectionCertificate ? [productData.inspectionCertificate] : []);
        
        // 새로 업로드한 파일들을 existingInspectionCertis로 이동하고 inspectionCertiFiles는 비우기
        return {
          ...product,
          existingInspectionCertis: savedCerts,
          inspectionCertiFiles: [],
        };
      }));
      
      // 저장 완료 후 2초 뒤 목록 페이지로 이동
      setTimeout(() => {
        router.push('/admin/certificate');
      }, 2000);
    } catch (error) {
      console.error('저장 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`저장에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  };

  // PDF 미리보기 함수 (저장하지 않고 PDF만 생성)
  const handlePreviewPDF = async () => {
    if (!validateForm()) {
      return;
    }

    setGeneratingPDF(true);
    setError('');
    setSuccess('');

    try {
      // 제품 데이터 준비 (handleSave와 동일한 방식, 단 저장하지 않음)
      const productsDataForPreview: CertificateProduct[] = [];
      
      console.log(`[PDF 미리보기] 시작 - 총 ${products.length}개 제품 처리 예정`);
      
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        
        console.log(`[PDF 미리보기] 제품 ${i + 1} "${product.productName}" 처리 시작:`, {
          totalFiles: product.inspectionCertiFiles?.length || 0,
        });
        
        if (!product.productName.trim() && !product.productCode.trim() && !product.quantity.trim()) {
          console.log(`[PDF 미리보기] 제품 ${i + 1} 빈 제품으로 제외됨`);
          continue; // 빈 제품은 제외
        }

        const productData: CertificateProduct = {
          productName: product.productName.trim(),
          productCode: product.productCode.trim() || undefined,
          quantity: product.quantity.trim() ? parseInt(product.quantity, 10) : undefined,
          heatNo: product.heatNo.trim() || undefined,
          material: product.material.trim() || undefined,
        };

        // 제품별 Inspection Certi 파일 처리
        // 새 파일만 PDF 생성에 포함 (기존 파일 제외)
        const inspectionCertificates: CertificateAttachment[] = [];
        
        // 새 파일만 처리 (기존 파일은 제외)
        if (product.inspectionCertiFiles && product.inspectionCertiFiles.length > 0) {
          const newFiles = product.inspectionCertiFiles.filter(item => item instanceof File) as File[];
          if (newFiles.length > 0) {
            const base64Promises = newFiles.map(async (file) => {
              try {
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
                  reader.readAsDataURL(file);
                });
                
                return {
                  name: file.name,
                  url: '',
                  storagePath: '',
                  size: file.size,
                  type: file.type,
                  uploadedAt: new Date(),
                  uploadedBy: 'admin',
                  base64: base64Data,
                } as CertificateAttachment;
              } catch (fileError) {
                console.error(`[PDF 미리보기] 제품 ${i + 1} 파일 "${file.name}" base64 변환 오류:`, fileError);
                return null;
              }
            });
            
            // 모든 base64 변환을 병렬로 대기
            const base64Results = await Promise.all(base64Promises);
            base64Results.forEach(result => {
              if (result) {
                inspectionCertificates.push(result);
              }
            });
          }
          
          console.log(`[PDF 미리보기] 제품 ${i + 1} 파일 처리 완료: 새 파일 ${newFiles.length}개, 최종 ${inspectionCertificates.length}개 (기존 파일 제외)`);
        } else {
          console.log(`[PDF 미리보기] 제품 ${i + 1} 파일 없음`);
        }
        
        // Material과 Heat No. 추출 (파일명에서) - 새 파일에서만 추출 (기존 파일 제외)
        const { material: collectedMaterial, heatNo: collectedHeatNo } = collectMaterialAndHeatNo(
          product.inspectionCertiFiles || [],
          [] // 기존 파일 제외
        );
        
        // Material과 Heat No. 업데이트
        productData.heatNo = collectedHeatNo || productData.heatNo;
        productData.material = collectedMaterial || productData.material;
        
        // inspectionCertificates 배열 설정
        const productDataWithCerts = productData as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        // 배열을 복사하여 참조 문제 방지 (파일이 없어도 빈 배열로 설정)
        productDataWithCerts.inspectionCertificates = inspectionCertificates.length > 0 ? [...inspectionCertificates] : [];
        
        // 첫 번째 파일을 inspectionCertificate에 저장 (하위 호환성)
        if (inspectionCertificates.length > 0) {
          productData.inspectionCertificate = inspectionCertificates[0];
        } else {
          productData.inspectionCertificate = undefined;
        }

        productsDataForPreview.push(productDataWithCerts);
        
        console.log(`[PDF 미리보기] 제품 ${i + 1} "${product.productName}" 처리 완료:`, {
          inspectionCertificatesCount: inspectionCertificates.length,
          totalFiles: product.inspectionCertiFiles?.length || 0,
        });
      }

      // 디버깅: 전체 productsDataForPreview 확인
      const totalFilesForPreview = productsDataForPreview.reduce((sum, p) => {
        const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        return sum + (pWithCerts.inspectionCertificates?.length || 0);
      }, 0);
      
      console.log(`[PDF 미리보기] 전체 productsDataForPreview 요약:`, {
        totalProducts: productsDataForPreview.length,
        totalFiles: totalFilesForPreview,
        products: productsDataForPreview.map((p, idx) => {
          const pWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
          return {
            index: idx + 1,
            productName: p.productName,
            inspectionCertificatesCount: pWithCerts.inspectionCertificates?.length || 0,
          };
        }),
      });

      // PDF 생성 전 각 제품의 Inspection Certificate 파일 개수 확인 (검증용)
      const expectedFileCountsForPreview: Array<{ productIndex: number; productName: string; fileCount: number }> = [];
      productsDataForPreview.forEach((p, idx) => {
        const productWithCerts = p as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] };
        const inspectionCerts = productWithCerts.inspectionCertificates && Array.isArray(productWithCerts.inspectionCertificates)
          ? productWithCerts.inspectionCertificates
          : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
        if (inspectionCerts.length > 0) {
          expectedFileCountsForPreview.push({
            productIndex: idx + 1,
            productName: p.productName || `제품 ${idx + 1}`,
            fileCount: inspectionCerts.length,
          });
        }
      });
      const totalExpectedFilesForPreview = expectedFileCountsForPreview.reduce((sum, item) => sum + item.fileCount, 0);
      console.log(`[PDF 미리보기] PDF 생성 전 예상 파일 개수: 총 ${totalExpectedFilesForPreview}개 (${expectedFileCountsForPreview.length}개 제품)`);

      // PDF 생성 (저장하지 않음)
      const result = await Promise.race([
        generatePDFBlobWithProducts(formData, productsDataForPreview),
        new Promise<{ 
          blob: Blob; 
          failedImageCount: number;
          fileValidationResults: Array<{
            productIndex: number;
            productName: string;
            files: Array<{
              fileName: string;
              included: boolean;
              error?: string;
            }>;
          }>;
        }>((_, reject) => {
          setTimeout(() => {
            reject(new Error('PDF 생성 타임아웃 (120초)'));
          }, 120000);
        })
      ]);
      
      // PDF 생성 후 간단한 검증 (미리보기에서는 상세 검증 생략하여 속도 향상)
      const totalFiles = result.fileValidationResults.reduce((sum, productResult) => sum + productResult.files.length, 0);
      const includedFiles = result.fileValidationResults.reduce((sum, productResult) => 
        sum + productResult.files.filter(f => f.included).length, 0);
      const failedFiles = totalFiles - includedFiles;
      
      console.log(`[PDF 미리보기] PDF 생성 완료: ${includedFiles}/${totalFiles}개 파일 포함`);
      
      if (failedFiles > 0) {
        console.warn(`[PDF 미리보기] ⚠️ ${failedFiles}개의 파일이 PDF에 포함되지 않았습니다.`);
      } else if (totalFiles > 0) {
        console.log(`[PDF 미리보기] ✅ 모든 파일(${totalFiles}개)이 PDF에 포함되었습니다.`);
      } else {
        console.log(`[PDF 미리보기] ℹ️ Inspection Certificate 파일이 없습니다.`);
      }

      const fileName = `MATERIAL_TEST_CERTIFICATE_${formData.certificateNo || 'CERT'}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // 새 창에서 PDF 열기
      const url = URL.createObjectURL(result.blob);
      const newWindow = window.open(url, '_blank');
      
      if (!newWindow) {
        // 팝업이 차단된 경우 다운로드로 대체
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setSuccess('PDF 미리보기가 생성되었습니다. 다운로드가 시작됩니다.');
      } else {
        setSuccess('PDF 미리보기가 새 창에서 열렸습니다.');
        // 새 창이 닫히면 URL 해제
        newWindow.addEventListener('beforeunload', () => {
          URL.revokeObjectURL(url);
        });
      }
      
      // 5초 후 URL 해제 (메모리 누수 방지)
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 5000);
      
    } catch (error) {
      console.error('[PDF 미리보기] PDF 생성 오류:', error);
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      
      if (errorMessage.includes('타임아웃')) {
        setError(`PDF 미리보기 생성에 실패했습니다: ${errorMessage}\n\n가능한 원인:\n- 첨부 파일이 너무 큽니다\n- 네트워크 연결이 불안정합니다\n- 브라우저 콘솔에서 자세한 오류를 확인하세요`);
      } else {
        setError(`PDF 미리보기 생성에 실패했습니다: ${errorMessage}\n\n브라우저 콘솔에서 자세한 오류를 확인하세요`);
      }
    } finally {
      setGeneratingPDF(false);
    }
  };

  // PDF 미리보기 함수 (기존 함수 - 사용하지 않음)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleGeneratePDF = async () => {
    if (!validateForm()) {
      return;
    }

    setGeneratingPDF(true);
    setError('');

    try {
      // 먼저 저장 (PDF 생성 전에 데이터 저장)
      if (certificateId) {
        // 제품별 Inspection Certi 업로드 및 제품 데이터 준비
        const productsDataForGenerate: CertificateProduct[] = [];
        for (let i = 0; i < products.length; i++) {
          const product = products[i];
          if (!product.productName.trim() && !product.productCode.trim() && !product.quantity.trim()) {
            continue; // 빈 제품은 제외
          }

          const productData: CertificateProduct = {
            productName: product.productName.trim(),
            productCode: product.productCode.trim() || undefined,
            quantity: product.quantity.trim() ? parseInt(product.quantity, 10) : undefined,
            heatNo: product.heatNo.trim() || undefined,
            material: product.material.trim() || undefined,
          };

          // 기존 파일은 PDF 생성 시 제외 (MTC에 포함되지 않음)
          // 새 파일만 PDF 생성에 포함
          const newFiles = product.inspectionCertiFiles.filter(item => item instanceof File) as File[];
          if (newFiles.length > 0) {
            // 새 파일은 base64로 변환하여 PDF 생성에 포함
            const newFilesWithBase64 = await Promise.all(newFiles.map(async (file) => {
              return new Promise<CertificateAttachment>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  if (typeof reader.result === 'string') {
                    resolve({
                      name: file.name,
                      url: '',
                      storagePath: undefined,
                      size: file.size,
                      type: file.type,
                      uploadedAt: new Date(),
                      uploadedBy: 'admin',
                      base64: reader.result,
                    });
                  } else {
                    reject(new Error('FileReader result is not a string'));
                  }
                };
                reader.onerror = () => reject(new Error('FileReader error'));
                reader.readAsDataURL(file);
              });
            }));
            
            productData.inspectionCertificate = newFilesWithBase64[0];
            (productData as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] }).inspectionCertificates = newFilesWithBase64;
          }

          productsDataForGenerate.push(productData);
        }

        const materialTestCertificate: MaterialTestCertificate = {
          certificateNo: formData.certificateNo.trim(),
          dateOfIssue: Timestamp.fromDate(new Date(formData.dateOfIssue)).toDate(),
          customer: formData.customer.trim(),
          poNo: formData.poNo.trim() || '',
          products: productsDataForGenerate,
          testResult: formData.testResult.trim(),
          createdAt: isEditMode ? new Date() : new Date(),
          updatedAt: new Date(),
          createdBy: 'admin',
        };

        // Firestore에 저장할 때는 Timestamp로 변환하고 undefined 필드 제거
        const materialTestCertificateForFirestore: Record<string, unknown> = {
          certificateNo: materialTestCertificate.certificateNo,
          dateOfIssue: Timestamp.fromDate(materialTestCertificate.dateOfIssue),
          customer: materialTestCertificate.customer,
          poNo: materialTestCertificate.poNo,
          description: materialTestCertificate.description,
          code: materialTestCertificate.code,
          quantity: materialTestCertificate.quantity,
          testResult: materialTestCertificate.testResult,
          heatNo: materialTestCertificate.heatNo,
          createdAt: Timestamp.fromDate(materialTestCertificate.createdAt),
          updatedAt: Timestamp.fromDate(materialTestCertificate.updatedAt),
          createdBy: materialTestCertificate.createdBy,
          products: productsDataForGenerate.map(p => {
            const productForFirestore: Record<string, unknown> = {
              productName: p.productName,
              productCode: p.productCode || null,
              quantity: p.quantity || null,
              heatNo: p.heatNo || null,
            };
            
            // inspectionCertificate가 있으면 추가
            if (p.inspectionCertificate) {
              // uploadedAt 처리
              let uploadedAtTimestamp: Timestamp;
              const uploadedAt = p.inspectionCertificate.uploadedAt;
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
                name: p.inspectionCertificate.name,
                url: p.inspectionCertificate.url,
                storagePath: p.inspectionCertificate.storagePath || null, // Storage 경로 저장
                size: p.inspectionCertificate.size,
                type: p.inspectionCertificate.type,
                uploadedAt: uploadedAtTimestamp,
                uploadedBy: p.inspectionCertificate.uploadedBy,
              };
            }
            
            return productForFirestore;
          }),
        };
        
        // inspectionCertificate가 있으면 추가 (undefined인 경우 필드 자체를 추가하지 않음) - 단일 제품 필드용 (하위 호환성)
        if (materialTestCertificate.inspectionCertificate) {
          let uploadedAtTimestamp: Timestamp;
          const uploadedAt = materialTestCertificate.inspectionCertificate.uploadedAt;
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
          
          materialTestCertificateForFirestore.inspectionCertificate = {
            name: materialTestCertificate.inspectionCertificate.name,
            url: materialTestCertificate.inspectionCertificate.url,
            storagePath: materialTestCertificate.inspectionCertificate.storagePath || null, // Storage 경로 저장
            size: materialTestCertificate.inspectionCertificate.size,
            type: materialTestCertificate.inspectionCertificate.type,
            uploadedAt: uploadedAtTimestamp,
            uploadedBy: materialTestCertificate.inspectionCertificate.uploadedBy,
          };
        }

        await updateDoc(doc(db, 'certificates', certificateId), {
          materialTestCertificate: materialTestCertificateForFirestore,
          updatedAt: Timestamp.now(),
          updatedBy: 'admin',
        });
      }

      // 제품 데이터 준비 (새로 선택한 Inspection Certi 파일도 포함)
      const productsDataForDownload: CertificateProduct[] = [];
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        if (!product.productName.trim() && !product.productCode.trim() && !product.quantity.trim()) {
          continue;
        }

        const productData: CertificateProduct = {
          productName: product.productName.trim(),
          productCode: product.productCode.trim() || undefined,
          quantity: product.quantity.trim() ? parseInt(product.quantity, 10) : undefined,
          heatNo: product.heatNo.trim() || undefined,
          material: product.material.trim() || undefined,
        };

        // Inspection Certi 파일 처리 (여러 파일 지원)
        const inspectionCertificates: CertificateAttachment[] = [];
        
        // 기존 파일 추가
        if (product.existingInspectionCertis && product.existingInspectionCertis.length > 0) {
          inspectionCertificates.push(...product.existingInspectionCertis);
        }
        
        // 새로 선택한 파일 업로드
        if (product.inspectionCertiFiles && product.inspectionCertiFiles.length > 0) {
          for (const file of product.inspectionCertiFiles) {
            try {
              const timestamp = Date.now();
              const randomId = Math.random().toString(36).substring(2, 15);
              const fileName = `inspection_certi_${certificateId || 'temp'}_${timestamp}_${randomId}_${file.name}`;
              const filePath = `certificates/${certificateId || 'temp'}/inspection_certi/${fileName}`;
              
              const storageRef = ref(storage, filePath);
              await uploadBytes(storageRef, file);
              const downloadURL = await getDownloadURL(storageRef);
              
              inspectionCertificates.push({
                name: file.name,
                url: downloadURL,
                storagePath: filePath,
                size: file.size,
                type: file.type,
                uploadedAt: new Date(),
                uploadedBy: 'admin',
              });
            } catch (fileError) {
              console.error(`Inspection Certi 파일 "${file.name}" 업로드 오류:`, fileError);
            }
          }
        }
        
        if (inspectionCertificates.length > 0) {
          productData.inspectionCertificate = inspectionCertificates[0];
          (productData as CertificateProduct & { inspectionCertificates?: CertificateAttachment[] }).inspectionCertificates = inspectionCertificates;
        }

        productsDataForDownload.push(productData);
      }

      // PDF 생성 전에 제품 데이터 확인
      console.log('[PDF 생성] 전달되는 제품 데이터:', productsDataForDownload.map(p => ({
        productName: p.productName,
        hasInspectionCert: !!p.inspectionCertificate,
        inspectionCertUrl: p.inspectionCertificate?.url,
        inspectionCertName: p.inspectionCertificate?.name,
      })));

      // PDF 생성 및 다운로드
      const result = await generatePDFBlobWithProducts(formData, productsDataForDownload);
      const fileName = `MATERIAL_TEST_CERTIFICATE_${formData.certificateNo || 'CERT'}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // Blob을 다운로드
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setSuccess('성적서 PDF가 생성되었습니다. 다운로드가 시작됩니다.');
      
      // 목록 페이지로 이동하지 않고 현재 페이지에 머물기
      // onSnapshot이 실시간으로 업데이트하므로 목록 페이지는 자동으로 업데이트됨
    } catch (error) {
      console.error('PDF 생성 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`PDF 생성에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setGeneratingPDF(false);
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
        <h1 className="text-2xl font-bold text-gray-900">{isEditMode ? '성적서 수정' : '성적서 작성'}</h1>
        <p className="text-gray-600 mt-2">{isEditMode ? '성적서 내용을 수정하고 PDF로 재생성할 수 있습니다' : '성적서 내용을 입력하고 PDF로 생성할 수 있습니다'}</p>
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
        <form onSubmit={(e) => { 
          e.preventDefault(); 
          if (!validateForm()) {
            return;
          }
          handleSave(); 
        }}>
          <div className="space-y-6">
            {/* 기본 정보 섹션 */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">기본 정보</h2>
              <div className="grid grid-cols-2 gap-4">
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
                <Input
                  id="dateOfIssue"
                  name="dateOfIssue"
                  type="date"
                  label="DATE OF ISSUE *"
                  required
                  value={formData.dateOfIssue}
                  onChange={handleChange}
                />
                <Input
                  id="customer"
                  name="customer"
                  type="text"
                  label="CUSTOMER *"
                  required
                  value={formData.customer}
                  onChange={handleChange}
                  placeholder="고객명"
                />
                <Input
                  id="poNo"
                  name="poNo"
                  type="text"
                  label="PO NO."
                  value={formData.poNo}
                  onChange={handleChange}
                  placeholder="발주번호"
                />
              </div>

              {/* 제품 정보 섹션 */}
              <div className="mt-6">
                <div className="mb-4 relative">
                  <h2 className="text-lg font-semibold text-gray-900">제품 정보 *</h2>
                  {fieldErrors.products && (
                    <div className="absolute left-0 top-6 mt-1 px-2 py-1 bg-orange-100 border border-orange-300 rounded shadow-lg text-xs text-gray-800 whitespace-nowrap z-10">
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span>{fieldErrors.products}</span>
                      </div>
                    </div>
                  )}
                </div>

                {products.map((product, index) => (
                  <div key={index} className="border-2 border-gray-300 rounded-lg p-5 space-y-4 bg-white shadow-sm mb-6">
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">
                          {index + 1}
                        </span>
                        <h3 className="text-base font-semibold text-gray-900">제품 {index + 1}</h3>
                      </div>
                      {products.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveProduct(index)}
                          disabled={saving || generatingPDF}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          삭제
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="text"
                        id={`productName-${index}`}
                        label="DESCRIPTION (제품명) *"
                        required
                        value={product.productName}
                        onChange={(e) => handleProductChange(index, 'productName', e.target.value)}
                        placeholder="제품명을 입력하세요"
                        disabled={saving || generatingPDF}
                      />

                      <Input
                        type="text"
                        id={`productCode-${index}`}
                        label="CODE (제품코드) *"
                        required
                        value={product.productCode}
                        onChange={(e) => handleProductChange(index, 'productCode', e.target.value)}
                        placeholder="제품코드를 입력하세요"
                        disabled={saving || generatingPDF}
                      />

                      <Input
                        type="text"
                        id={`quantity-${index}`}
                        inputMode="numeric"
                        label="Q'TY (수량) *"
                        required
                        value={product.quantity}
                        onChange={(e) => handleProductChange(index, 'quantity', e.target.value)}
                        placeholder="수량을 입력하세요"
                        pattern="[0-9]*"
                        disabled={saving || generatingPDF}
                      />

                      <Input
                        type="text"
                        label="MATERIAL (소재)"
                        value={product.material}
                        onChange={(e) => handleProductChange(index, 'material', e.target.value)}
                        placeholder="소재를 입력하세요 (예: 316/316L, 304)"
                        disabled={saving || generatingPDF}
                      />

                      <div className="relative">
                        <Input
                          type="text"
                          label="HEAT NO. (히트번호)"
                          value={product.heatNo}
                          onChange={(e) => handleProductChange(index, 'heatNo', e.target.value)}
                          placeholder="히트번호를 입력하세요"
                          disabled={saving || generatingPDF}
                        />
                        {/* 소재/사이즈 표시 (Heat No. 아래) */}
                        {product.materialSizes && product.materialSizes.length > 0 && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-gray-600 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                            <span className="font-medium">소재/사이즈:</span>
                            {product.materialSizes.map((ms, msIndex) => (
                              <span key={msIndex}>
                                {ms.materialType} / {ms.size}mm
                                {msIndex < product.materialSizes!.length - 1 && ','}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 제품별 Inspection Certi 첨부 */}
                    <div className="mt-4">
                      <h3 className="text-md font-semibold text-gray-800 mb-3">INSPECTION CERTIFICATE 첨부 (제품 {index + 1})</h3>
                      
                      {/* 기존 파일 목록 (MTC에 포함되지 않음) */}
                      {product.existingInspectionCertis && product.existingInspectionCertis.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs text-gray-600 mb-2 font-medium">기존 파일 (MTC에 포함되지 않음)</p>
                          <div className="space-y-2">
                            {product.existingInspectionCertis.map((cert, fileIndex) => (
                              <div key={fileIndex} className="p-3 bg-gray-100 rounded-md border border-gray-300">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-700 font-medium">{cert.name}</span>
                                        {cert.size && (
                                          <span className="text-xs text-gray-500">
                                            ({(cert.size / 1024).toFixed(1)} KB)
                                          </span>
                                        )}
                                        <span className="text-xs text-red-600 font-medium">(MTC에 포함되지 않음)</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                                    {cert.url && (
                                      <a
                                        href={cert.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:text-blue-800 text-sm font-medium underline"
                                      >
                                        다운로드
                                      </a>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setProducts(prev => {
                                          const newProducts = [...prev];
                                          const currentProduct = newProducts[index];
                                          const updatedExisting = currentProduct.existingInspectionCertis.filter((_, i) => i !== fileIndex);
                                          newProducts[index] = {
                                            ...currentProduct,
                                            existingInspectionCertis: updatedExisting,
                                          };
                                          return newProducts;
                                        });
                                      }}
                                      disabled={saving || generatingPDF}
                                      className="text-red-600 hover:text-red-800 text-sm font-medium underline disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="파일 삭제"
                                    >
                                      삭제
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* 새 파일 목록 (MTC에 포함됨) */}
                      {product.inspectionCertiFiles && product.inspectionCertiFiles.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs text-gray-600 mb-2 font-medium">새 파일 (MTC에 포함됨)</p>
                          <div className="space-y-2">
                            {product.inspectionCertiFiles
                              .filter(item => item instanceof File) // File 객체만 표시
                              .map((file, fileIndex) => {
                                const fileName = file.name;
                                const fileSize = file.size;
                                
                                return (
                                  <div key={fileIndex} className="p-3 bg-blue-50 rounded-md border border-blue-200">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm text-gray-900 font-medium">{fileName}</span>
                                            {fileSize && (
                                              <span className="text-xs text-gray-500">
                                                ({(fileSize / 1024).toFixed(1)} KB)
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteInspectionCertiFile(index, fileIndex)}
                                          disabled={saving || generatingPDF}
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
                            if (selectedFiles && selectedFiles.length > 0) {
                              handleProductInspectionCertiAdd(index, selectedFiles);
                            }
                            // 파일 입력 필드 초기화는 상태 업데이트 후에 수행 (같은 파일 다시 선택 가능하도록)
                            setTimeout(() => {
                              e.target.value = '';
                            }, 100);
                          }}
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={saving || generatingPDF}
                        />
                        <p className="mt-1 text-xs text-gray-500">여러 파일을 선택할 수 있습니다.</p>
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* 제품 추가 버튼 */}
                <div className="mt-6 flex justify-end">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleAddProduct}
                    disabled={saving || generatingPDF}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold shadow-md hover:shadow-lg transition-shadow"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    제품 추가
                  </Button>
                </div>
              </div>

            </div>

            {/* 액션 버튼 */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/admin/certificate')}
                disabled={saving || generatingPDF}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handlePreviewPDF}
                disabled={saving || generatingPDF}
                loading={generatingPDF}
              >
                PDF 미리보기
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSave}
                disabled={saving || generatingPDF}
                loading={saving}
              >
                저장
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MaterialTestCertificatePage() {
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
      <MaterialTestCertificateContent />
    </Suspense>
  );
}

