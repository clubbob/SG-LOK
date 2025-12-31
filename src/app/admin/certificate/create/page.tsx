"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, doc, getDoc, updateDoc, addDoc, Timestamp, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getBlob } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { CertificateAttachment, MaterialTestCertificate, CertificateProduct } from '@/types';

const ADMIN_SESSION_KEY = 'admin_session';

// jsPDF 타입 정의 (필요한 메서드만 포함)
interface JSPDFDocument {
  addImage: (imgData: string, format: string, x: number, y: number, width: number, height: number) => void;
  setFont: (fontName: string, fontStyle?: string) => void;
  setFontSize: (size: number) => void;
  text: (text: string | string[], x: number, y: number) => void;
}

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
): Promise<Blob> => {
  // 동적 import로 jsPDF 로드
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();

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
  const margin = 20;
  let yPosition = margin;

  // 제목: MATERIAL TEST CERTIFICATE
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('MATERIAL TEST CERTIFICATE', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 10;

  // 표준 규격 텍스트
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('According to DIN 50049 3.1 / EN 10204 3.1 / ISO 10474 3.1', pageWidth / 2, yPosition, { align: 'center' });
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
  doc.text(formData.dateOfIssue || '-', rightColumn + 40, rightY);
  leftY += lineHeight;
  rightY += lineHeight;

  // 두 번째 행: CUSTOMER (왼쪽)
  doc.setFont('helvetica', 'bold');
  doc.text('CUSTOMER:', leftColumn, leftY);
  doc.setFont('helvetica', 'normal');
  renderKoreanText(doc, formData.customer || '-', leftColumn + 50, leftY, 12);
  leftY += lineHeight;

  // 세 번째 행: PO NO. (왼쪽)
  doc.setFont('helvetica', 'bold');
  doc.text('PO NO.:', leftColumn, leftY);
  doc.setFont('helvetica', 'normal');
  renderKoreanText(doc, formData.poNo || '-', leftColumn + 50, leftY, 12);
  leftY += lineHeight;

  // 제품 정보 테이블
  yPosition = leftY + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('PRODUCT INFORMATION:', margin, yPosition);
  yPosition += 10;

  // 제품 테이블 헤더
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  const tableStartY = yPosition;
  doc.text('No.', margin, yPosition);
  doc.text('DESCRIPTION', margin + 15, yPosition);
  doc.text('CODE', margin + 80, yPosition);
  doc.text("Q'TY", margin + 120, yPosition);
  doc.text('HEAT NO.', margin + 150, yPosition);
  yPosition += 8;
  
  // 구분선
  doc.setLineWidth(0.3);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 5;

  // 제품 데이터 행
  doc.setFont('helvetica', 'normal');
  products.forEach((product, index) => {
    if (yPosition > pageHeight - 30) {
      doc.addPage();
      yPosition = margin + 10;
    }
    
    doc.text(`${index + 1}.`, margin, yPosition);
    const descriptionText = product.productName || '-';
    const descriptionLines = doc.splitTextToSize(descriptionText, 50);
    let descY = yPosition;
    descriptionLines.forEach((line: string) => {
      renderKoreanText(doc, line, margin + 15, descY, 10);
      descY += 5;
    });
    renderKoreanText(doc, product.productCode || '-', margin + 80, yPosition, 10);
    doc.text((product.quantity || 0).toString(), margin + 120, yPosition);
    renderKoreanText(doc, product.heatNo || '-', margin + 150, yPosition, 10);
    yPosition = Math.max(descY, yPosition + 5) + 3;
  });

  // INSPECTION CERTIFICATE 첨부 정보 (제품별)
  yPosition += 10;
  console.log('[PDF 생성] 제품 개수:', products.length);
  for (let index = 0; index < products.length; index++) {
    const product = products[index];
    console.log(`[PDF 생성] 제품 ${index + 1}:`, {
      productName: product.productName,
      hasInspectionCerti: !!product.inspectionCertificate,
      inspectionCertiUrl: product.inspectionCertificate?.url,
    });
    if (product.inspectionCertificate) {
      if (yPosition > pageHeight - 50) {
        doc.addPage();
        yPosition = margin + 10;
      }
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`INSPECTION CERTIFICATE (Product ${index + 1}):`, margin, yPosition);
      yPosition += 6;
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`File: ${product.inspectionCertificate.name}`, margin, yPosition);
      yPosition += 5;
      if (product.inspectionCertificate.size) {
        doc.text(`Size: ${(product.inspectionCertificate.size / 1024).toFixed(1)} KB`, margin, yPosition);
        yPosition += 5;
      }
      
      // 이미지 파일인 경우 별도 페이지에 이미지 삽입
      const inspectionCert = product.inspectionCertificate;
      if (inspectionCert?.base64) {
        try {
          const base64Data = inspectionCert.base64; // undefined 체크 완료
          
          // Base64 이미지를 Image 객체로 로드하여 크기 확인
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('이미지 로드 타임아웃')), 3000);
            img.onload = () => {
              clearTimeout(timeout);
              resolve();
            };
            img.onerror = () => {
              clearTimeout(timeout);
              reject(new Error('이미지 로드 실패'));
            };
            img.src = base64Data;
          });
          
          // 이미지 비율 확인 (가로가 더 길면 landscape 모드 사용)
          const imgAspectRatio = img.width / img.height;
          const isLandscape = img.width > img.height;
          
          // 새로운 페이지 추가 (이미지 비율에 따라 portrait 또는 landscape)
          if (isLandscape) {
            doc.addPage('landscape');
          } else {
            doc.addPage();
          }
          yPosition = margin + 10;
          
          // 제목 표시
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text(`INSPECTION CERTIFICATE (Product ${index + 1})`, margin, yPosition);
          yPosition += 10;
          
          // 이미지 크기 계산 (페이지에 맞게 조정)
          const pageWidth = doc.internal.pageSize.getWidth();
          const pageHeight = doc.internal.pageSize.getHeight();
          const availableWidth = pageWidth - (margin * 2);
          const availableHeight = pageHeight - yPosition - margin - 20;
          
          const ratio = Math.min(availableWidth / img.width, availableHeight / img.height, 1);
          const imgWidthMM = img.width * ratio * 0.264583;
          const imgHeightMM = img.height * ratio * 0.264583;
          
          // 이미지를 페이지 중앙에 배치
          const imgX = (pageWidth - imgWidthMM) / 2;
          const imgY = yPosition;
          
          doc.addImage(base64Data, 'PNG', imgX, imgY, imgWidthMM, imgHeightMM);
          
        } catch (error) {
          // 이미지 로드 실패 시 조용히 건너뛰기
          console.warn(`제품 ${index + 1}의 이미지 로드 실패:`, error);
        }
      }
    }
  }

  // 페이지 넘김 체크
  if (yPosition > pageHeight - 30) {
    doc.addPage();
    yPosition = margin;
  }

  // 하단 정보 (DEFAULT 고정 내용은 나중에 추가)
  // 주석 처리: 사용자가 요청할 때까지 표시하지 않음
  // yPosition = pageHeight - 30;
  // doc.setFontSize(8);
  // doc.setFont('helvetica', 'italic');
  // doc.text('* DEFAULT 고정 내용은 추후 추가 예정입니다.', margin, yPosition);

  // PDF를 Blob으로 변환하여 반환
  try {
    const pdfBlob = doc.output('blob');
    return pdfBlob;
  } catch (error) {
    console.error('PDF 생성 오류:', error);
    // PDF 생성 실패 시 빈 PDF 반환 (에러 방지)
    const fallbackDoc = new jsPDF();
    fallbackDoc.text('PDF 생성 중 오류가 발생했습니다.', 20, 20);
    return fallbackDoc.output('blob');
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
  const pdfBlob = await generatePDFBlobWithProducts(formData, productsDataForDownload);
  const fileName = `MATERIAL_TEST_CERTIFICATE_${formData.certificateNo || 'CERT'}_${new Date().toISOString().split('T')[0]}.pdf`;
  
  // Blob을 다운로드
  const url = URL.createObjectURL(pdfBlob);
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

  // 제품 배열 (제품명, 제품코드, 수량, 히트번호, Inspection Certi)
  const [products, setProducts] = useState<Array<{
    productName: string;
    productCode: string;
    quantity: string;
    heatNo: string;
    inspectionCertiFile: File | null;
    existingInspectionCerti: CertificateAttachment | null;
  }>>([{ productName: '', productCode: '', quantity: '', heatNo: '', inspectionCertiFile: null, existingInspectionCerti: null }]);

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
                setProducts(mtc.products.map((p: CertificateProduct) => ({
                  productName: p.productName || '',
                  productCode: p.productCode || '',
                  quantity: p.quantity?.toString() || '',
                  heatNo: p.heatNo || '',
                  inspectionCertiFile: null,
                  existingInspectionCerti: p.inspectionCertificate || null,
                })));
              } else if (mtc.description || mtc.code || mtc.quantity) {
                // 기존 단일 제품 데이터를 배열로 변환
                setProducts([{
                  productName: mtc.description || '',
                  productCode: mtc.code || '',
                  quantity: mtc.quantity?.toString() || '',
                  heatNo: mtc.heatNo || '',
                  inspectionCertiFile: null,
                  existingInspectionCerti: mtc.inspectionCertificate || null,
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
                  inspectionCertiFile: null,
                  existingInspectionCerti: p.inspectionCertificate || null,
                })));
              } else if (data.productName || data.productCode || data.quantity) {
                // 기존 단일 제품 데이터를 배열로 변환
                setProducts([{
                  productName: data.productName || '',
                  productCode: data.productCode || '',
                  quantity: data.quantity?.toString() || '',
                  heatNo: data.lotNumber || '',
                  inspectionCertiFile: null,
                  existingInspectionCerti: null,
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
            setFormData({
              certificateNo: mtc.certificateNo || '',
              dateOfIssue: mtc.dateOfIssue?.toDate().toISOString().split('T')[0] || '',
              customer: mtc.customer || '',
              poNo: mtc.poNo || '',
              testResult: mtc.testResult || '',
            });
            
            // 제품 데이터 로드 (products 배열이 있으면 사용, 없으면 기존 단일 제품 필드 사용)
            if (mtc.products && Array.isArray(mtc.products) && mtc.products.length > 0) {
              setProducts(mtc.products.map((p: CertificateProduct) => ({
                productName: p.productName || '',
                productCode: p.productCode || '',
                quantity: p.quantity?.toString() || '',
                heatNo: p.heatNo || '',
                inspectionCertiFile: null,
                existingInspectionCerti: p.inspectionCertificate || null,
              })));
            } else if (mtc.description || mtc.code || mtc.quantity) {
              // 기존 단일 제품 데이터를 배열로 변환
              setProducts([{
                productName: mtc.description || '',
                productCode: mtc.code || '',
                quantity: mtc.quantity?.toString() || '',
                heatNo: mtc.heatNo || '',
                inspectionCertiFile: null,
                existingInspectionCerti: mtc.inspectionCertificate || null,
              }]);
            }
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
              setProducts(data.products.map((p: CertificateProduct) => ({
                productName: p.productName || '',
                productCode: p.productCode || '',
                quantity: p.quantity?.toString() || '',
                heatNo: p.heatNo || '',
                inspectionCertiFile: null,
                existingInspectionCerti: p.inspectionCertificate || null,
              })));
            } else if (data.productName || data.productCode || data.quantity) {
              // 기존 단일 제품 데이터를 배열로 변환
              setProducts([{
                productName: data.productName || '',
                productCode: data.productCode || '',
                quantity: data.quantity?.toString() || '',
                heatNo: data.lotNumber || '',
                inspectionCertiFile: null,
                existingInspectionCerti: null,
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
  const handleProductChange = (index: number, field: 'productName' | 'productCode' | 'quantity' | 'heatNo', value: string) => {
    setProducts(prev => {
      const newProducts = [...prev];
      // 제품명, 제품코드, 히트번호는 대문자로 변환
      const uppercaseFields = ['productName', 'productCode', 'heatNo'];
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
        inspectionCertiFile: null, // 새 파일은 복사하지 않음
        existingInspectionCerti: null, // 기존 Inspection Certi도 복사하지 않음
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

  // 제품별 Inspection Certi 파일 변경
  const handleProductInspectionCertiChange = (index: number, file: File | null) => {
    setProducts(prev => {
      const newProducts = [...prev];
      newProducts[index] = { ...newProducts[index], inspectionCertiFile: file };
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
        };

        // 제품별 Inspection Certi 파일 업로드
        if (product.inspectionCertiFile) {
          try {
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(2, 15);
            const fileName = `inspection_certi_${certificateId || 'temp'}_${timestamp}_${randomId}_${product.inspectionCertiFile.name}`;
            const filePath = `certificates/${certificateId || 'temp'}/inspection_certi/${fileName}`;
            
            const storageRef = ref(storage, filePath);
            await uploadBytes(storageRef, product.inspectionCertiFile);
            const downloadURL = await getDownloadURL(storageRef);
            
            // 이미지 파일인 경우 Base64로 변환
            let base64Data: string | undefined;
            const fileType = product.inspectionCertiFile.type || '';
            const fileNameLower = product.inspectionCertiFile.name.toLowerCase();
            const isImage = fileType.startsWith('image/') || 
                           fileNameLower.endsWith('.jpg') || 
                           fileNameLower.endsWith('.jpeg') || 
                           fileNameLower.endsWith('.png') || 
                           fileNameLower.endsWith('.gif') || 
                           fileNameLower.endsWith('.bmp');
            
            if (isImage) {
              try {
                base64Data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    if (typeof reader.result === 'string') {
                      resolve(reader.result);
                    } else {
                      reject(new Error('FileReader result is not a string'));
                    }
                  };
                  reader.onerror = () => reject(new Error('FileReader error'));
                  reader.readAsDataURL(product.inspectionCertiFile!);
                });
              } catch (base64Error) {
                console.warn(`이미지 Base64 변환 실패 (계속 진행):`, base64Error);
                // Base64 변환 실패해도 계속 진행
              }
            }
            
            productData.inspectionCertificate = {
              name: product.inspectionCertiFile.name,
              url: downloadURL,
              size: product.inspectionCertiFile.size,
              type: product.inspectionCertiFile.type,
              uploadedAt: new Date(),
              uploadedBy: 'admin',
              base64: base64Data, // Base64 데이터 추가
            };
          } catch (fileError) {
            console.error(`Inspection Certi 파일 "${product.inspectionCertiFile.name}" 업로드 오류:`, fileError);
            throw fileError;
          }
        } else if (product.existingInspectionCerti) {
          // 기존 Inspection Certi가 있으면 그대로 사용
          productData.inspectionCertificate = product.existingInspectionCerti;
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

      // PDF 생성 (products 배열 전달) - 전체 타임아웃 30초
      let pdfBlob: Blob;
      try {
        pdfBlob = await Promise.race([
          generatePDFBlobWithProducts(formData, productsData),
          new Promise<Blob>((_, reject) => {
            setTimeout(() => {
              reject(new Error('PDF 생성 타임아웃 (30초)'));
            }, 30000);
          })
        ]);
      } catch (pdfError) {
        console.error('PDF 생성 오류:', pdfError);
        // PDF 생성 실패해도 계속 진행 (이미지 로드 실패 등)
        // 빈 PDF 생성
        const { jsPDF } = await import('jspdf');
        const fallbackDoc = new jsPDF();
        fallbackDoc.text('PDF 생성 중 오류가 발생했습니다.', 20, 20);
        pdfBlob = fallbackDoc.output('blob');
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
      
      // Storage에 PDF 업로드
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
          
          // inspectionCertificate가 있으면 추가
          if (p.inspectionCertificate) {
            productForFirestore.inspectionCertificate = {
              name: p.inspectionCertificate.name,
              url: p.inspectionCertificate.url,
              size: p.inspectionCertificate.size,
              type: p.inspectionCertificate.type,
              uploadedAt: Timestamp.fromDate(p.inspectionCertificate.uploadedAt),
              uploadedBy: p.inspectionCertificate.uploadedBy,
              // Base64 데이터도 저장 (이미지 파일인 경우)
              ...(p.inspectionCertificate.base64 && { base64: p.inspectionCertificate.base64 }),
            };
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
      setSuccess(isActuallyCopyMode ? '기존 성적서를 복사하여 새로운 성적서가 생성되었습니다.' : '성적서 내용이 저장되었고 PDF 파일이 업로드되었습니다.');
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

          if (product.existingInspectionCerti) {
            productData.inspectionCertificate = product.existingInspectionCerti;
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
        };
        
        // inspectionCertificate가 있으면 추가 (undefined인 경우 필드 자체를 추가하지 않음)
        if (materialTestCertificate.inspectionCertificate) {
          materialTestCertificateForFirestore.inspectionCertificate = {
            name: materialTestCertificate.inspectionCertificate.name,
            url: materialTestCertificate.inspectionCertificate.url,
            size: materialTestCertificate.inspectionCertificate.size,
            type: materialTestCertificate.inspectionCertificate.type,
            uploadedAt: Timestamp.fromDate(materialTestCertificate.inspectionCertificate.uploadedAt),
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
        };

        // 새로 선택한 Inspection Certi 파일이 있으면 업로드
        if (product.inspectionCertiFile) {
          try {
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(2, 15);
            const fileName = `inspection_certi_${certificateId || 'temp'}_${timestamp}_${randomId}_${product.inspectionCertiFile.name}`;
            const filePath = `certificates/${certificateId || 'temp'}/inspection_certi/${fileName}`;
            
            const storageRef = ref(storage, filePath);
            await uploadBytes(storageRef, product.inspectionCertiFile);
            const downloadURL = await getDownloadURL(storageRef);
            
            productData.inspectionCertificate = {
              name: product.inspectionCertiFile.name,
              url: downloadURL,
              size: product.inspectionCertiFile.size,
              type: product.inspectionCertiFile.type,
              uploadedAt: new Date(),
              uploadedBy: 'admin',
            };
          } catch (fileError) {
            console.error(`Inspection Certi 파일 "${product.inspectionCertiFile.name}" 업로드 오류:`, fileError);
            // 업로드 실패해도 계속 진행 (기존 파일이 있으면 사용)
            if (product.existingInspectionCerti) {
              productData.inspectionCertificate = product.existingInspectionCerti;
            }
          }
        } else if (product.existingInspectionCerti) {
          // 기존 Inspection Certi가 있으면 사용
          productData.inspectionCertificate = product.existingInspectionCerti;
        }

        productsDataForDownload.push(productData);
      }

      // PDF 생성 및 다운로드
      const pdfBlob = await generatePDFBlobWithProducts(formData, productsDataForDownload);
      const fileName = `MATERIAL_TEST_CERTIFICATE_${formData.certificateNo || 'CERT'}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // Blob을 다운로드
      const url = URL.createObjectURL(pdfBlob);
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
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">제품 정보 *</h2>
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
                      {product.existingInspectionCerti ? (
                        <div className="mb-3 p-3 bg-gray-50 rounded-md border border-gray-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span className="text-sm text-gray-900">{product.existingInspectionCerti.name}</span>
                              {product.existingInspectionCerti.size && (
                                <span className="text-xs text-gray-500">
                                  ({(product.existingInspectionCerti.size / 1024).toFixed(1)} KB)
                                </span>
                              )}
                            </div>
                            <a
                              href={product.existingInspectionCerti.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium underline"
                            >
                              다운로드
                            </a>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 mb-2">업로드된 파일이 없습니다.</p>
                      )}
                      <div>
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            handleProductInspectionCertiChange(index, file);
                          }}
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={saving || generatingPDF}
                        />
                        {product.inspectionCertiFile && (
                          <p className="mt-2 text-sm text-gray-600">선택된 파일: {product.inspectionCertiFile.name}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
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

