"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, doc, getDoc, updateDoc, Timestamp, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { CertificateAttachment, MaterialTestCertificate } from '@/types';

const ADMIN_SESSION_KEY = 'admin_session';

// PDF를 Blob으로 생성하는 함수
const generatePDFBlob = async (
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
): Promise<Blob> => {
  // 동적 import로 jsPDF 로드
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();

  // 페이지 설정
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  let yPosition = margin;

  // 제목: MATERIAL TEST CERTIFICATE
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('MATERIAL TEST CERTIFICATE', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 15;

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

  // 왼쪽 컬럼
  doc.setFont('helvetica', 'bold');
  doc.text('CERTIFICATE NO.:', leftColumn, leftY);
  doc.setFont('helvetica', 'normal');
  doc.text(formData.certificateNo || '-', leftColumn + 50, leftY);
  leftY += lineHeight;

  doc.setFont('helvetica', 'bold');
  doc.text('DATE OF ISSUE:', leftColumn, leftY);
  doc.setFont('helvetica', 'normal');
  doc.text(formData.dateOfIssue || '-', leftColumn + 50, leftY);
  leftY += lineHeight;

  doc.setFont('helvetica', 'bold');
  doc.text('CUSTOMER:', leftColumn, leftY);
  doc.setFont('helvetica', 'normal');
  doc.text(formData.customer || '-', leftColumn + 50, leftY);
  leftY += lineHeight;

  doc.setFont('helvetica', 'bold');
  doc.text('PO NO.:', leftColumn, leftY);
  doc.setFont('helvetica', 'normal');
  doc.text(formData.poNo || '-', leftColumn + 50, leftY);
  leftY += lineHeight;

  // 오른쪽 컬럼
  doc.setFont('helvetica', 'bold');
  doc.text('DESCRIPTION:', rightColumn, rightY);
  doc.setFont('helvetica', 'normal');
  const descriptionLines = doc.splitTextToSize(formData.description || '-', 60);
  doc.text(descriptionLines, rightColumn + 40, rightY);
  rightY += lineHeight * descriptionLines.length;

  doc.setFont('helvetica', 'bold');
  doc.text('CODE:', rightColumn, rightY);
  doc.setFont('helvetica', 'normal');
  doc.text(formData.code || '-', rightColumn + 40, rightY);
  rightY += lineHeight;

  doc.setFont('helvetica', 'bold');
  doc.text("Q'TY:", rightColumn, rightY);
  doc.setFont('helvetica', 'normal');
  doc.text(formData.quantity || '-', rightColumn + 40, rightY);
  rightY += lineHeight;

  doc.setFont('helvetica', 'bold');
  doc.text('HEAT NO.:', rightColumn, rightY);
  doc.setFont('helvetica', 'normal');
  doc.text(formData.heatNo || '-', rightColumn + 40, rightY);
  rightY += lineHeight;

  // INSPECTION CERTIFICATE 첨부 정보
  yPosition = Math.max(leftY, rightY) + 10;
  if (inspectionCertificate) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('INSPECTION CERTIFICATE:', margin, yPosition);
    yPosition += 8;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`File: ${inspectionCertificate.name}`, margin, yPosition);
    yPosition += 6;
    if (inspectionCertificate.size) {
      doc.text(`Size: ${(inspectionCertificate.size / 1024).toFixed(1)} KB`, margin, yPosition);
      yPosition += 6;
    }
    yPosition += 5;
  }

  // 페이지 넘김 체크
  if (yPosition > pageHeight - 30) {
    doc.addPage();
    yPosition = margin;
  }

  // 하단 정보 (DEFAULT 고정 내용은 나중에 추가)
  yPosition = pageHeight - 30;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text('* DEFAULT 고정 내용은 추후 추가 예정입니다.', margin, yPosition);

  // PDF를 Blob으로 변환하여 반환
  const pdfBlob = doc.output('blob');
  return pdfBlob;
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
  const pdfBlob = await generatePDFBlob(formData, inspectionCertificate);
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
  const [isEditMode, setIsEditMode] = useState(false);
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
    description: '',          // DESCRIPTION
    code: '',                 // CODE
    quantity: '',             // Q'TY
    testResult: '',           // TEST RESULT
    heatNo: '',               // HEAT NO.
  });

  // INSPECTION CERTIFICATE 첨부
  const [inspectionCertificateFile, setInspectionCertificateFile] = useState<File | null>(null);
  const [uploadingInspectionFile, setUploadingInspectionFile] = useState(false);
  const [existingInspectionFile, setExistingInspectionFile] = useState<CertificateAttachment | null>(null);

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

  // 성적서 요청 정보 불러오기 (certificateId 필수)
  useEffect(() => {
    const loadCertificateData = async () => {
      if (!certificateId) {
        setError('성적서 요청 ID가 필요합니다. 성적서 목록에서 성적서 작성 버튼을 클릭해주세요.');
        setTimeout(() => {
          router.push('/admin/certificate');
        }, 3000);
        return;
      }

      setLoadingCertificate(true);
      try {
        const certDoc = await getDoc(doc(db, 'certificates', certificateId));
        if (certDoc.exists()) {
          const data = certDoc.data();

          // 기존 MATERIAL TEST CERTIFICATE 내용이 있으면 불러오기
          if (data.materialTestCertificate) {
            setIsEditMode(true);
            const mtc = data.materialTestCertificate;
            setFormData({
              certificateNo: mtc.certificateNo || '',
              dateOfIssue: mtc.dateOfIssue?.toDate().toISOString().split('T')[0] || '',
              customer: mtc.customer || '',
              poNo: mtc.poNo || '',
              description: mtc.description || '',
              code: mtc.code || '',
              quantity: mtc.quantity?.toString() || '',
              testResult: mtc.testResult || '',
              heatNo: mtc.heatNo || '',
            });
            
            if (mtc.inspectionCertificate) {
              setExistingInspectionFile({
                name: mtc.inspectionCertificate.name,
                url: mtc.inspectionCertificate.url,
                size: mtc.inspectionCertificate.size,
                type: mtc.inspectionCertificate.type,
                uploadedAt: mtc.inspectionCertificate.uploadedAt?.toDate() || new Date(),
                uploadedBy: mtc.inspectionCertificate.uploadedBy || 'admin',
              });
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
              description: data.productName || '',
              code: data.productCode || '',
              quantity: data.quantity?.toString() || '',
              heatNo: data.lotNumber || '',
              dateOfIssue: today, // 오늘 날짜
            }));
          }
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    // certificateNo는 수정 불가 (시스템 자동 생성)
    if (name === 'certificateNo') {
      return;
    }
    // 영문 입력 필드는 자동으로 대문자로 변환
    const uppercaseFields = ['customer', 'poNo', 'description', 'code', 'heatNo'];
    const processedValue = uppercaseFields.includes(name) ? value.toUpperCase() : value;
    setFormData(prev => ({
      ...prev,
      [name]: processedValue,
    }));
  };

  const handleInspectionFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setInspectionCertificateFile(file);
    }
  };

  const handleInspectionFileUpload = async () => {
    if (!inspectionCertificateFile || !certificateId) {
      setError('파일을 선택해주세요.');
      return;
    }

    setUploadingInspectionFile(true);
    setError('');

    try {
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 15);
      const fileName = `inspection_${certificateId}_${timestamp}_${randomId}_${inspectionCertificateFile.name}`;
      const filePath = `certificates/${certificateId}/inspection/${fileName}`;
      
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, inspectionCertificateFile);
      const downloadURL = await getDownloadURL(storageRef);
      
      const attachment: CertificateAttachment = {
        name: inspectionCertificateFile.name,
        url: downloadURL,
        size: inspectionCertificateFile.size,
        type: inspectionCertificateFile.type,
        uploadedAt: new Date(),
        uploadedBy: 'admin',
      };

      setExistingInspectionFile(attachment);
      setInspectionCertificateFile(null);
      setSuccess('INSPECTION CERTIFICATE 파일이 업로드되었습니다.');
    } catch (error) {
      console.error('파일 업로드 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`파일 업로드에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setUploadingInspectionFile(false);
    }
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
    if (!formData.description.trim()) {
      setError('DESCRIPTION을 입력해주세요.');
      setTimeout(() => {
        const element = document.getElementById('description');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (element as HTMLInputElement).focus();
        }
      }, 100);
      return false;
    }
    if (!formData.code.trim()) {
      setError('CODE를 입력해주세요.');
      setTimeout(() => {
        const element = document.getElementById('code');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (element as HTMLInputElement).focus();
        }
      }, 100);
      return false;
    }
    if (!formData.quantity.trim()) {
      setError("Q'TY를 입력해주세요.");
      setTimeout(() => {
        const element = document.getElementById('quantity');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (element as HTMLInputElement).focus();
        }
      }, 100);
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!certificateId) {
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
      const materialTestCertificate: MaterialTestCertificate = {
        certificateNo: formData.certificateNo.trim(),
        dateOfIssue: Timestamp.fromDate(new Date(formData.dateOfIssue)).toDate(),
        customer: formData.customer.trim(),
        poNo: formData.poNo.trim() || '',
        description: formData.description.trim(),
        code: formData.code.trim() || '',
        quantity: formData.quantity.trim() ? parseInt(formData.quantity, 10) : 0,
        testResult: formData.testResult.trim(),
        heatNo: formData.heatNo.trim() || '',
        inspectionCertificate: existingInspectionFile || undefined,
        createdAt: isEditMode ? new Date() : new Date(), // 기존 데이터가 있으면 유지
        updatedAt: new Date(),
        createdBy: 'admin',
      };

      // PDF 생성
      const pdfBlob = await generatePDFBlob(formData, existingInspectionFile);
      const fileName = `MATERIAL_TEST_CERTIFICATE_${formData.certificateNo || 'CERT'}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // Storage에 PDF 업로드
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 15);
      const storageFileName = `certificate_${certificateId}_${timestamp}_${randomId}_${fileName}`;
      const filePath = `certificates/${certificateId}/${storageFileName}`;
      
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

      const certificateFileForFirestore = {
        ...certificateFile,
        uploadedAt: Timestamp.fromDate(certificateFile.uploadedAt),
      };

      await updateDoc(doc(db, 'certificates', certificateId), {
        materialTestCertificate: materialTestCertificateForFirestore,
        certificateFile: certificateFileForFirestore,
        updatedAt: Timestamp.now(),
        updatedBy: 'admin',
      });

      setSuccess('성적서 내용이 저장되었고 PDF 파일이 업로드되었습니다.');
      setIsEditMode(true);
      
      // 2초 후 목록 페이지로 이동
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
        const materialTestCertificate: MaterialTestCertificate = {
          certificateNo: formData.certificateNo.trim(),
          dateOfIssue: Timestamp.fromDate(new Date(formData.dateOfIssue)).toDate(),
          customer: formData.customer.trim(),
          poNo: formData.poNo.trim() || '',
          description: formData.description.trim(),
          code: formData.code.trim() || '',
          quantity: formData.quantity.trim() ? parseInt(formData.quantity, 10) : 0,
          testResult: formData.testResult.trim(),
          heatNo: formData.heatNo.trim() || '',
          inspectionCertificate: existingInspectionFile || undefined,
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

      // PDF 생성 및 다운로드
      await generateAndDownloadPDF(formData, existingInspectionFile);
      
      setSuccess('성적서 PDF가 생성되었습니다. 다운로드가 시작됩니다.');
      
      // 2초 후 목록 페이지로 이동
      setTimeout(() => {
        router.push('/admin/certificate');
      }, 2000);
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
                <Input
                  id="description"
                  name="description"
                  type="text"
                  label="DESCRIPTION *"
                  required
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="제품명"
                />
                <Input
                  id="code"
                  name="code"
                  type="text"
                  label="CODE *"
                  required
                  value={formData.code}
                  onChange={handleChange}
                  placeholder="제품코드"
                />
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  label="Q'TY *"
                  required
                  value={formData.quantity}
                  onChange={handleChange}
                  placeholder="수량"
                />
                <Input
                  id="heatNo"
                  name="heatNo"
                  type="text"
                  label="HEAT NO."
                  value={formData.heatNo}
                  onChange={handleChange}
                  placeholder="히트번호"
                />
              </div>

              {/* INSPECTION CERTIFICATE 첨부 */}
              <div className="mt-6">
                <h3 className="text-md font-semibold text-gray-800 mb-3">INSPECTION CERTIFICATE 첨부</h3>
                {existingInspectionFile ? (
                  <div className="mb-3 p-3 bg-gray-50 rounded-md border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="text-sm text-gray-900">{existingInspectionFile.name}</span>
                        {existingInspectionFile.size && (
                          <span className="text-xs text-gray-500">
                            ({(existingInspectionFile.size / 1024).toFixed(1)} KB)
                          </span>
                        )}
                      </div>
                      <a
                        href={existingInspectionFile.url}
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
                    onChange={handleInspectionFileChange}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={uploadingInspectionFile || saving || generatingPDF}
                  />
                  {inspectionCertificateFile && (
                    <>
                      <p className="mt-2 text-sm text-gray-600">선택된 파일: {inspectionCertificateFile.name}</p>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        className="mt-2"
                        onClick={handleInspectionFileUpload}
                        disabled={uploadingInspectionFile || saving || generatingPDF}
                        loading={uploadingInspectionFile}
                      >
                        파일 업로드
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 액션 버튼 */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/admin/certificate')}
                disabled={saving || generatingPDF || uploadingInspectionFile}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSave}
                disabled={saving || generatingPDF || uploadingInspectionFile}
                loading={saving}
              >
                저장
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleGeneratePDF}
                disabled={saving || generatingPDF || uploadingInspectionFile}
                loading={generatingPDF}
              >
                PDF 생성 및 다운로드
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

