"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, doc, getDoc, updateDoc, addDoc, Timestamp, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
): Promise<{ blob: Blob; failedImageCount: number }> => {
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
    const materialWidth = colResult - colMaterial - 2; // 약 19.8mm
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
  for (let index = 0; index < products.length; index++) {
    const product = products[index];
    // 여러 파일 지원: inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
    const inspectionCerts = (product as any).inspectionCertificates || 
                            (product.inspectionCertificate ? [product.inspectionCertificate] : []);
    
    console.log(`[PDF 생성] 제품 ${index + 1} 처리 중:`, {
      inspectionCertCount: inspectionCerts.length,
      certs: inspectionCerts.map((c: CertificateAttachment) => ({ name: c.name, url: c.url })),
    });
    
    // 각 Inspection Certificate 파일을 순회하며 추가
    for (let certIndex = 0; certIndex < inspectionCerts.length; certIndex++) {
      const inspectionCert = inspectionCerts[certIndex];
      
      if (inspectionCert?.url) {
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
        let base64ImageData: string;
        const imageFormat = 'PNG' as const;
        let img: HTMLImageElement;
        
        if (inspectionCert.base64) {
          // base64 데이터가 있으면 직접 사용
          console.log('[PDF 생성] base64 데이터 사용');
          const base64Data = inspectionCert.base64.includes(',') 
            ? inspectionCert.base64 
            : `data:image/png;base64,${inspectionCert.base64}`;
          
          img = new Image();
          img.src = base64Data;
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('이미지 로드 타임아웃 (30초)')), 30000);
            img.onload = () => {
              clearTimeout(timeout);
              resolve();
            };
            img.onerror = () => {
              clearTimeout(timeout);
              reject(new Error('이미지 로드 실패'));
            };
          });
          
          base64ImageData = base64Data.includes(',') 
            ? base64Data.split(',')[1] 
            : inspectionCert.base64;
        } else {
          // 이미지 다운로드
          console.log('[PDF 생성] 이미지 다운로드 시작, URL:', inspectionCert.url, 'storagePath:', inspectionCert.storagePath);
          
          let blob: Blob | null = null;
          let downloadSuccess = false;
          
          // 방법 1: storagePath가 있으면 getDownloadURL 사용 (재시도 로직 포함)
          if (inspectionCert.storagePath) {
            const maxRetries = 2;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                console.log(`[PDF 생성] getDownloadURL 시도 ${attempt}/${maxRetries}, storagePath:`, inspectionCert.storagePath);
                const storageRef = ref(storage, inspectionCert.storagePath);
                
                // getDownloadURL로 URL 가져오기 (타임아웃 60초)
                const downloadURL = await Promise.race([
                  getDownloadURL(storageRef),
                  new Promise<string>((_, reject) => 
                    setTimeout(() => reject(new Error(`getDownloadURL 타임아웃 (60초) - 시도 ${attempt}/${maxRetries}`)), 60000)
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
                console.error(`[PDF 생성] storagePath 다운로드 시도 ${attempt}/${maxRetries} 실패:`, storageError);
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
          if (!downloadSuccess && inspectionCert.url) {
            try {
              console.log('[PDF 생성] URL로 다운로드 시도:', inspectionCert.url);
              // 타임아웃 60초로 설정
              let response: Response | null = null;
              try {
                const fetchPromise = fetch(inspectionCert.url, {
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
          
          if (!downloadSuccess) {
            // 에러 발생 시 해당 이미지를 건너뛰고 계속 진행
            failedImageCount++;
            const errorMsg = `이미지 다운로드에 실패했습니다. storagePath와 URL 모두 사용할 수 없습니다.`;
            console.warn(`⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) ${errorMsg} (실패한 이미지: ${failedImageCount}개)`);
            // 에러를 throw하지 않고 continue로 다음 이미지로 넘어감
            continue;
          }
          
          // downloadSuccess가 true이고 blob이 있는 경우에만 처리 진행
          if (!downloadSuccess || !blob) {
            // 다운로드 실패 또는 blob이 없으면 다음 이미지로
            if (!downloadSuccess) {
              failedImageCount++;
              const errorMsg = `이미지 다운로드에 실패했습니다. storagePath와 URL 모두 사용할 수 없습니다.`;
              console.warn(`⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) ${errorMsg} (실패한 이미지: ${failedImageCount}개)`);
            } else if (!blob) {
              failedImageCount++;
              console.warn(`⚠️ 제품 ${index + 1}의 Inspection Certificate 파일 ${certIndex + 1} (${inspectionCert.name || '이름 없음'}) blob이 없습니다. (실패한 이미지: ${failedImageCount}개)`);
            }
            continue;
          }
          
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
          
          // 이미지 크기 확인
          img = new Image();
          img.src = base64Data;
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('이미지 로드 타임아웃 (30초)')), 30000);
            img.onload = () => {
              clearTimeout(timeout);
              console.log('[PDF 생성] 이미지 크기 확인 완료:', img.width, 'x', img.height);
              resolve();
            };
            img.onerror = () => {
              clearTimeout(timeout);
              reject(new Error('이미지 로드 실패'));
            };
          });
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
        doc.text(certTitle, imageMargin, yPosition);
        yPosition += 10;
        
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
          console.log(`[PDF 생성] 제품 ${index + 1} 이미지 추가 완료 - 페이지 번호: ${doc.getNumberOfPages()}`);
        } catch (addImageError) {
          console.error(`[PDF 생성] doc.addImage 실패:`, addImageError);
          throw new Error(`이미지를 PDF에 추가하는데 실패했습니다: ${addImageError instanceof Error ? addImageError.message : String(addImageError)}`);
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
  }
  
  console.log(`[PDF 생성] 모든 이미지 처리 완료. 총 페이지 수: ${doc.getNumberOfPages()}, 실패한 이미지: ${failedImageCount}개`);

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
    return { blob: pdfBlob, failedImageCount };
  } catch (error) {
    console.error('PDF 생성 오류:', error);
    // PDF 생성 실패 시 빈 PDF 반환 (에러 방지)
    const { jsPDF: jsPDFFallback } = await import('jspdf');
    const fallbackDoc = new jsPDFFallback({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    fallbackDoc.text('PDF 생성 중 오류가 발생했습니다.', 20, 20);
    return { blob: fallbackDoc.output('blob'), failedImageCount };
  }
};

// PDF 생성 및 다운로드 함수 (기존 함수 유지)
const generateAndDownloadPDF = async (
  formData: {
    certificateNo: string;
    dateOfIssue: string;
    customer: string;
    poNo: string;
    description: string;
    code: string;
    quantity: string;
    testResult: string;
    heatNo: string;
  },
  inspectionCertificate?: CertificateAttachment | null
) => {
  // 제품 데이터 준비
  const productsDataForDownload: CertificateProduct[] = [];
  // inspectionCertificate는 더 이상 단일 파일이 아니라 제품별로 처리되므로 빈 배열로 처리
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
const collectMaterialAndHeatNo = (
  inspectionCertiFiles: File[],
  existingInspectionCertis: CertificateAttachment[]
): { material: string; heatNo: string } => {
  const materials: string[] = []; // Set 대신 배열 사용하여 파일 순서대로 수집
  const heatNos: string[] = [];
  
  // 새로 선택한 파일들 처리
  for (const file of inspectionCertiFiles) {
    const { material, heatNo } = extractMaterialAndHeatNo(file.name);
    if (material) {
      materials.push(material); // 중복 제거하지 않고 순서대로 추가
    }
    if (heatNo) {
      heatNos.push(heatNo);
    }
  }
  
  // 기존 파일들 처리
  for (const cert of existingInspectionCertis) {
    const { material, heatNo } = extractMaterialAndHeatNo(cert.name);
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

  // 제품 배열 (제품명, 제품코드, 수량, 히트번호, Material, Inspection Certi)
  const [products, setProducts] = useState<Array<{
    productName: string;
    productCode: string;
    quantity: string;
    heatNo: string;
    material: string;
    inspectionCertiFiles: File[];
    existingInspectionCertis: CertificateAttachment[];
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
                setProducts(mtc.products.map((p: CertificateProduct) => {
                  // inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
                  const existingCerts = (p as any).inspectionCertificates && Array.isArray((p as any).inspectionCertificates)
                    ? (p as any).inspectionCertificates
                    : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
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
              } else if (mtc.description || mtc.code || mtc.quantity) {
                // 기존 단일 제품 데이터를 배열로 변환
                // inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
                const existingCerts = (mtc as any).inspectionCertificates && Array.isArray((mtc as any).inspectionCertificates)
                  ? (mtc as any).inspectionCertificates
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
              loadedProducts = mtc.products.map((p: CertificateProduct) => {
                // inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
                const existingCerts = (p as any).inspectionCertificates && Array.isArray((p as any).inspectionCertificates)
                  ? (p as any).inspectionCertificates
                  : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
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
              });
            } else if (mtc.description || mtc.code || mtc.quantity) {
              // 기존 단일 제품 데이터를 배열로 변환
              // inspectionCertificates 배열이 있으면 사용, 없으면 inspectionCertificate 단일 객체를 배열로 변환
              const existingCerts = (mtc as any).inspectionCertificates && Array.isArray((mtc as any).inspectionCertificates)
                ? (mtc as any).inspectionCertificates
                : (mtc.inspectionCertificate ? [mtc.inspectionCertificate] : []);
              const { material, heatNo } = collectMaterialAndHeatNo([], existingCerts);
              loadedProducts = [{
                productName: mtc.description || '',
                productCode: mtc.code || '',
                quantity: mtc.quantity?.toString() || '',
                heatNo: heatNo || mtc.heatNo || '',
                material: material || mtc.material || '',
                inspectionCertiFiles: [],
                existingInspectionCertis: existingCerts,
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
  }, [certificateId, copyFromId, router]);

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
  };

  // 제품 필드 변경 핸들러
  const handleProductChange = (index: number, field: 'productName' | 'productCode' | 'quantity' | 'heatNo' | 'material', value: string) => {
    setProducts(prev => {
      const newProducts = [...prev];
      // 제품명, 제품코드, 히트번호, Material은 대문자로 변환
      const uppercaseFields = ['productName', 'productCode', 'heatNo', 'material'];
      const processedValue = uppercaseFields.includes(field) ? value.toUpperCase() : value;
      newProducts[index] = { ...newProducts[index], [field]: processedValue };
      return newProducts;
    });
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
        existingInspectionCertis: [], // 기존 Inspection Certi도 복사하지 않음
      };
      return [...prev, newProduct];
    });
  };

  // 제품 삭제
  const handleRemoveProduct = (index: number) => {
    if (products.length > 1) {
      setProducts(prev => prev.filter((_, i) => i !== index));
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
      
      console.log('[파일 추가] 현재 제품의 기존 파일:', currentProduct.inspectionCertiFiles.map(f => f.name));
      
      // 모든 파일(기존 + 새로 추가된)에서 Material과 Heat No. 수집
      const updatedFiles = [...currentProduct.inspectionCertiFiles, ...newFiles];
      const { material, heatNo } = collectMaterialAndHeatNo(updatedFiles, currentProduct.existingInspectionCertis);
      
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
      
      // 남은 파일들에서 Material과 Heat No. 다시 수집
      const { material, heatNo } = collectMaterialAndHeatNo(updatedFiles, currentProduct.existingInspectionCertis);
      
      newProducts[productIndex] = {
        ...currentProduct,
        inspectionCertiFiles: updatedFiles,
        material,
        heatNo,
      };
      return newProducts;
    });
  };

  // 제품별 기존 Inspection Certi 파일 삭제
  const handleDeleteExistingInspectionCerti = (productIndex: number, fileIndex: number) => {
    if (!confirm('기존 Inspection Certificate 파일을 삭제하시겠습니까?')) {
      return;
    }
    
    setProducts(prev => {
      const newProducts = [...prev];
      const currentProduct = newProducts[productIndex];
      const updatedExistingFiles = currentProduct.existingInspectionCertis.filter((_, i) => i !== fileIndex);
      
      // 남은 파일들에서 Material과 Heat No. 다시 수집
      const { material, heatNo } = collectMaterialAndHeatNo(currentProduct.inspectionCertiFiles, updatedExistingFiles);
      
      newProducts[productIndex] = { 
        ...currentProduct, 
        existingInspectionCertis: updatedExistingFiles,
        material,
        heatNo,
      };
      return newProducts;
    });
  };


  const validateForm = () => {
    if (!formData.certificateNo.trim()) {
      setError('CERTIFICATE NO.를 입력해주세요.');
      setTimeout(() => {
        const element = document.getElementById('certificateNo');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (element as HTMLInputElement).focus();
        }
      }, 100);
      return false;
    }
    if (!formData.dateOfIssue.trim()) {
      setError('DATE OF ISSUE를 선택해주세요.');
      setTimeout(() => {
        const element = document.getElementById('dateOfIssue');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (element as HTMLInputElement).focus();
        }
      }, 100);
      return false;
    }
    if (!formData.customer.trim()) {
      setError('CUSTOMER를 입력해주세요.');
      setTimeout(() => {
        const element = document.getElementById('customer');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (element as HTMLInputElement).focus();
        }
      }, 100);
      return false;
    }
    
    // 제품 검증 (최소 1개 제품은 필수)
    const validProducts = products.filter(p => p.productName.trim() || p.productCode.trim() || p.quantity.trim());
    if (validProducts.length === 0) {
      setError('최소 1개 이상의 제품을 입력해주세요.');
      return false;
    }
    
      // 각 제품의 필수 필드 검증
      for (let i = 0; i < validProducts.length; i++) {
        const product = validProducts[i];
        if (!product.productName.trim()) {
          setError(`제품 ${i + 1}: 제품명을 입력해주세요.`);
          return false;
        }
        if (!product.productCode.trim()) {
          setError(`제품 ${i + 1}: CODE를 입력해주세요.`);
          return false;
        }
        if (!product.quantity.trim()) {
          setError(`제품 ${i + 1}: 수량을 입력해주세요.`);
          return false;
        }
      }
    
    return true;
  };

  // 변경사항 확인 함수
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
        const currentCertCount = (current.existingInspectionCertis?.length || 0) + (current.inspectionCertiFiles?.length || 0);
        const originalCertCount = (original.existingInspectionCertis?.length || 0);
        
        if (currentCertCount !== originalCertCount) {
          console.log(`[변경사항 확인] 제품 ${i + 1} Inspection Cert 파일 개수 변경됨:`, {
            current: currentCertCount,
            original: originalCertCount,
          });
          return true;
        }

        // 새로 추가된 파일이 있는지 확인
        if (current.inspectionCertiFiles && current.inspectionCertiFiles.length > 0) {
          console.log(`[변경사항 확인] 제품 ${i + 1} 새 파일 추가됨`);
          return true;
        }

        // 기존 파일이 삭제되었는지 확인 (이름으로 비교)
        const currentCertNames = [
          ...(current.existingInspectionCertis || []).map(c => c.name || '').filter(name => name.length > 0),
          ...(current.inspectionCertiFiles || []).map(f => f.name || '').filter(name => name.length > 0)
        ].sort();
        const originalCertNames = (original.existingInspectionCertis || [])
          .map(c => c.name || '')
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

        // 제품별 Inspection Certi 파일 업로드 (여러 파일 지원)
        const inspectionCertificates: CertificateAttachment[] = [];
        
        // 기존 파일 추가
        if (product.existingInspectionCertis && product.existingInspectionCertis.length > 0) {
          inspectionCertificates.push(...product.existingInspectionCertis);
        }
        
        // 새로 선택한 파일 업로드
        if (product.inspectionCertiFiles && product.inspectionCertiFiles.length > 0) {
          for (const file of product.inspectionCertiFiles) {
            try {
              console.log(`[저장] 제품 ${i + 1} Inspection Certi 파일 업로드 시작:`, {
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
              });
              
              const timestamp = Date.now();
              const randomId = Math.random().toString(36).substring(2, 15);
              const fileName = `inspection_certi_${certificateId || 'temp'}_${timestamp}_${randomId}_${file.name}`;
              const filePath = `certificates/${certificateId || 'temp'}/inspection_certi/${fileName}`;
              
              console.log(`[저장] Storage 경로:`, filePath);
              const storageRef = ref(storage, filePath);
              
              console.log(`[저장] uploadBytes 시작...`);
              await uploadBytes(storageRef, file);
              console.log(`[저장] uploadBytes 완료`);
              
              console.log(`[저장] getDownloadURL 시작...`);
              const downloadURL = await getDownloadURL(storageRef);
              console.log(`[저장] getDownloadURL 완료, URL:`, downloadURL);
              
              // 로컬 File 객체를 base64로 변환 (PDF 생성 시 즉시 사용)
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
              
              inspectionCertificates.push({
                name: file.name,
                url: downloadURL,
                storagePath: filePath,
                size: file.size,
                type: file.type,
                uploadedAt: new Date(),
                uploadedBy: 'admin',
                base64: base64Data,
              });
              
              console.log(`[저장] 제품 ${i + 1} Inspection Certi 파일 업로드 완료, base64 길이:`, base64Data.length);
            } catch (fileError) {
              console.error(`[저장] 제품 ${i + 1} Inspection Certi 파일 업로드 오류:`, fileError);
              const errorInfo: Record<string, unknown> = {
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
              };
              if (fileError instanceof Error) {
                errorInfo.errorMessage = fileError.message;
                errorInfo.errorName = fileError.name;
                errorInfo.errorStack = fileError.stack;
              } else {
                errorInfo.errorString = String(fileError);
              }
              console.error('[저장] 에러 상세:', errorInfo);
              throw fileError;
            }
          }
        }
        
        // 첫 번째 파일을 inspectionCertificate에 저장 (하위 호환성)
        if (inspectionCertificates.length > 0) {
          productData.inspectionCertificate = inspectionCertificates[0];
          // 배열로도 저장 (향후 확장용)
          (productData as any).inspectionCertificates = inspectionCertificates;
        }

        productsData.push(productData);
      }

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

      // PDF 생성 (수정 모드에서도 항상 새로 생성)
      let pdfBlob: Blob | null = null;
      let failedImageCount = 0;
      
      // 항상 새 PDF 생성
      try {
        const result = await Promise.race([
          generatePDFBlobWithProducts(formData, productsData),
          new Promise<{ blob: Blob; failedImageCount: number }>((_, reject) => {
            setTimeout(() => {
              reject(new Error('PDF 생성 타임아웃 (120초)'));
            }, 120000); // 2분으로 증가
          })
        ]);
        pdfBlob = result.blob;
        failedImageCount = result.failedImageCount;
        
        if (failedImageCount > 0) {
          console.warn(`⚠️ ${failedImageCount}개의 이미지를 PDF에 포함하지 못했습니다.`);
        }
      } catch (pdfError) {
        console.error('PDF 생성 오류:', pdfError);
        // PDF 생성 실패 시 빈 PDF 생성
        const { jsPDF } = await import('jspdf');
        const fallbackDoc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        fallbackDoc.text('PDF 생성 중 오류가 발생했습니다. 일부 이미지를 포함하지 못했습니다.', 20, 20);
        pdfBlob = fallbackDoc.output('blob');
        failedImageCount = productsData.length;
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

      // 새 PDF 업로드
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 15);
      const storageFileName = `certificate_${targetCertificateId}_${timestamp}_${randomId}_${fileName}`;
      const filePath = `certificates/${targetCertificateId}/${storageFileName}`;
      
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, pdfBlob);
      const downloadURL = await getDownloadURL(storageRef);
      
      // certificateFile 정보 생성
      const certificateFile: CertificateAttachment = {
        name: fileName,
        url: downloadURL,
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
          const inspectionCerts = (p as any).inspectionCertificates && Array.isArray((p as any).inspectionCertificates)
            ? (p as any).inspectionCertificates
            : (p.inspectionCertificate ? [p.inspectionCertificate] : []);
          
          if (inspectionCerts.length > 0) {
            // 첫 번째 파일을 inspectionCertificate에 저장 (하위 호환성)
            const firstCert = inspectionCerts[0];
            // uploadedAt 처리: Date 객체면 Timestamp로 변환, 이미 Timestamp면 그대로 사용, 없으면 현재 시간 사용
            let uploadedAtTimestamp: Timestamp;
            const uploadedAt = firstCert.uploadedAt;
            if (uploadedAt) {
              if (uploadedAt instanceof Date) {
                uploadedAtTimestamp = Timestamp.fromDate(uploadedAt);
              } else if (uploadedAt && typeof uploadedAt === 'object' && 'toDate' in uploadedAt) {
                // 이미 Timestamp 객체인 경우
                const timestampObj = uploadedAt as { toDate?: () => Date };
                if (typeof timestampObj.toDate === 'function') {
                  uploadedAtTimestamp = uploadedAt as Timestamp;
                } else {
                  uploadedAtTimestamp = Timestamp.fromDate(new Date());
                }
              } else {
                // 다른 형태인 경우 현재 시간 사용
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
            
            // inspectionCertificates 배열도 저장 (여러 파일 지원)
            if (inspectionCerts.length > 1) {
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
            }
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
        ? '기존 성적서를 복사하여 새로운 성적서가 생성되었습니다.' 
        : '성적서 내용이 저장되었고 PDF 파일이 업로드되었습니다.';
      
      if (failedImageCount > 0) {
        successMessage += ` (참고: ${failedImageCount}개의 이미지를 PDF에 포함하지 못했습니다. 네트워크 문제일 수 있습니다.)`;
      }
      
      setSuccess(successMessage);
      setIsEditMode(true);
      
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
          };

          if (product.existingInspectionCertis && product.existingInspectionCertis.length > 0) {
            productData.inspectionCertificate = product.existingInspectionCertis[0];
            (productData as any).inspectionCertificates = product.existingInspectionCertis;
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
          (productData as any).inspectionCertificates = inspectionCertificates;
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
        <h1 className="text-2xl font-bold text-gray-900">성적서 작성</h1>
        <p className="text-gray-600 mt-2">성적서 내용을 입력하고 PDF로 생성할 수 있습니다</p>
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
                          disabled={saving || generatingPDF}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          삭제
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="text"
                        label="DESCRIPTION (제품명) *"
                        required
                        value={product.productName}
                        onChange={(e) => handleProductChange(index, 'productName', e.target.value)}
                        placeholder="제품명을 입력하세요"
                        disabled={saving || generatingPDF}
                      />

                      <Input
                        type="text"
                        label="CODE (제품코드) *"
                        required
                        value={product.productCode}
                        onChange={(e) => handleProductChange(index, 'productCode', e.target.value)}
                        placeholder="제품코드를 입력하세요"
                        disabled={saving || generatingPDF}
                      />

                      <Input
                        type="text"
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

                      <Input
                        type="text"
                        label="HEAT NO. (히트번호)"
                        value={product.heatNo}
                        onChange={(e) => handleProductChange(index, 'heatNo', e.target.value)}
                        placeholder="히트번호를 입력하세요"
                        disabled={saving || generatingPDF}
                      />
                    </div>

                    {/* 제품별 Inspection Certi 첨부 */}
                    <div className="mt-4">
                      <h3 className="text-md font-semibold text-gray-800 mb-3">INSPECTION CERTIFICATE 첨부 (제품 {index + 1})</h3>
                      {/* 기존 파일 목록 */}
                      {product.existingInspectionCertis && product.existingInspectionCertis.length > 0 && (
                        <div className="mb-3 space-y-2">
                          {product.existingInspectionCertis.map((cert, certIndex) => (
                            <div key={certIndex} className="p-3 bg-gray-50 rounded-md border border-gray-200">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  <span className="text-sm text-gray-900">{cert.name}</span>
                                  {cert.size && (
                                    <span className="text-xs text-gray-500">
                                      ({(cert.size / 1024).toFixed(1)} KB)
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <a
                                    href={cert.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 text-sm font-medium underline"
                                  >
                                    다운로드
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteExistingInspectionCerti(index, certIndex)}
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
                      )}
                      {/* 새로 선택한 파일 목록 */}
                      {product.inspectionCertiFiles && product.inspectionCertiFiles.length > 0 && (
                        <div className="mb-3 space-y-2">
                          {product.inspectionCertiFiles.map((file, fileIndex) => (
                            <div key={fileIndex} className="p-3 bg-blue-50 rounded-md border border-blue-200">
                              <div className="flex items-center justify-between">
                                <p className="text-sm text-gray-600">선택된 파일: {file.name}</p>
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
                          ))}
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
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddProduct}
                    disabled={saving || generatingPDF}
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
                onClick={() => router.push('/admin/certificate')}
                disabled={saving || generatingPDF}
              >
                취소
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

