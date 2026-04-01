"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { collection, query, getDocs, doc, updateDoc, Timestamp, onSnapshot, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { Certificate, CertificateStatus, CertificateType, CertificateAttachment } from '@/types';
import { formatDateShort } from '@/lib/utils';

const ADMIN_SESSION_KEY = 'admin_session';

const STATUS_LABELS: Record<CertificateStatus, string> = {
  pending: '대기',
  in_progress: '진행',
  completed: '완료',
  cancelled: '취소',
};

const STATUS_COLORS: Record<CertificateStatus, string> = {
  pending: 'bg-yellow-400 text-white',
  in_progress: 'bg-blue-500 text-white',
  completed: 'bg-green-500 text-white',
  cancelled: 'bg-red-500 text-white',
};

const CERTIFICATE_TYPE_LABELS: Record<CertificateType, string> = {
  quality: '품질',
  safety: '안전',
  environmental: '환경',
  other: '기타',
};

// 15자 초과시 ... 표시
const truncateText = (text: string, maxLength: number = 15): string => {
  if (!text) return '-';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
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

export default function AdminCertificatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loadingCertificates, setLoadingCertificates] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedCertificate, setSelectedCertificate] = useState<Certificate | null>(null);
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [displayedCertificates, setDisplayedCertificates] = useState<Certificate[]>([]);
  const itemsPerPage = 10; // 명시적으로 10개로 설정
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredCertificates, setFilteredCertificates] = useState<Certificate[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeletingMultiple, setIsDeletingMultiple] = useState(false);
  const [approvingCertificate, setApprovingCertificate] = useState<Certificate | null>(null);
  const [approvalForm, setApprovalForm] = useState({
    requestedCompletionDate: '',
  });
  const [approving, setApproving] = useState(false);
  const [memoModalCertificate, setMemoModalCertificate] = useState<Certificate | null>(null);
  const [attachmentModalCertificate, setAttachmentModalCertificate] = useState<Certificate | null>(null);
  
  // 오늘 날짜를 YYYY-MM-DD 형식으로 변환
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    // 관리자 세션 확인
    if (!checkAdminAuth()) {
      router.push('/admin/login');
      return;
    }

    // 실시간 성적서 목록 구독
    const certificatesRef = collection(db, 'certificates');
    const q = query(certificatesRef);
    
    const unsubscribeSnapshot = onSnapshot(
      q,
      (querySnapshot) => {
        const certificatesData: Certificate[] = [];
        
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          
          // 성적서 데이터인지 확인
          // 생산요청 데이터와 구분: productionReason이 있으면 생산요청, 없으면 성적서
          // 또는 certificateType이 있으면 성적서로 간주
          if (data.productionReason) {
            // 생산요청 데이터는 건너뛰기
            console.warn(`생산요청 데이터가 certificates 컬렉션에 있습니다: ${doc.id}`);
            return;
          }
          
          // certificateType이 없으면 성적서가 아닐 수 있음 (안전장치)
          if (!data.certificateType && !data.requestDate) {
            console.warn(`성적서 형식이 아닌 데이터가 있습니다: ${doc.id}`);
            return;
          }
          
          // 목록 표시는 작성/수정에서 실제 저장되는 materialTestCertificate.products를 우선 사용
          // (구버전 문서는 data.products로 fallback)
          const mtcProducts =
            data.materialTestCertificate?.products && Array.isArray(data.materialTestCertificate.products)
              ? data.materialTestCertificate.products
              : [];
          const legacyProducts = data.products && Array.isArray(data.products) ? data.products : [];
          const effectiveProducts = mtcProducts.length > 0 ? mtcProducts : legacyProducts;
          const firstProduct = effectiveProducts.length > 0 ? effectiveProducts[0] : null;
          const summarizedProductName =
            effectiveProducts.length <= 1
              ? (firstProduct?.productName || data.productName)
              : `${firstProduct?.productName || data.productName || '제품'} 외 ${effectiveProducts.length - 1}건`;
          const summarizedProductCode =
            effectiveProducts.length <= 1
              ? (firstProduct?.productCode || data.productCode)
              : `${firstProduct?.productCode || data.productCode || '-'} 외 ${effectiveProducts.length - 1}건`;
          const summarizedQuantity = effectiveProducts.length > 0
            ? effectiveProducts.reduce((sum: number, p: { quantity?: number | string }) => {
                const value =
                  typeof p.quantity === 'number'
                    ? p.quantity
                    : typeof p.quantity === 'string'
                      ? Number.parseInt(p.quantity, 10)
                      : 0;
                return sum + (Number.isFinite(value) ? value : 0);
              }, 0)
            : (firstProduct?.quantity || data.quantity);
          
          certificatesData.push({
            id: doc.id,
            userId: data.userId,
            userName: data.userName,
            userEmail: data.userEmail,
            userCompany: data.userCompany,
            customerName: data.customerName,
            orderNumber: data.orderNumber,
            products: effectiveProducts,
            productName: summarizedProductName,
            productCode: summarizedProductCode,
            lotNumber: firstProduct?.lotNumber || data.lotNumber,
            quantity: summarizedQuantity,
            certificateType: data.certificateType || 'quality',
            requestDate: data.requestDate?.toDate() || new Date(),
            requestedCompletionDate: data.requestedCompletionDate?.toDate(),
            status: data.status || 'pending',
            memo: data.memo || '',
            attachments: data.attachments || [],
            certificateFile: data.certificateFile,
            materialTestCertificate: data.materialTestCertificate,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            createdBy: data.createdBy,
            updatedBy: data.updatedBy,
            completedAt: data.completedAt?.toDate(),
            completedBy: data.completedBy,
          });
        });
        
        // 클라이언트 사이드 정렬 (오래된 순으로 정렬)
        certificatesData.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        
        setCertificates(certificatesData);
        setLoadingCertificates(false);
      },
      (error) => {
        console.error('성적서 목록 로드 오류:', error);
        const firebaseError = error as { code?: string; message?: string };
        setError(`성적서 목록을 불러오는데 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
        setLoadingCertificates(false);
      }
    );

    return () => unsubscribeSnapshot();
  }, [router]);

  // 검색 필터링
  useEffect(() => {
    const statusFilterParam = searchParams.get('status');
    const validStatusFilter =
      statusFilterParam === 'pending' ||
      statusFilterParam === 'in_progress' ||
      statusFilterParam === 'completed' ||
      statusFilterParam === 'cancelled'
        ? statusFilterParam
        : null;
    const statusFiltered = validStatusFilter
      ? certificates.filter((cert) => cert.status === validStatusFilter)
      : certificates;

    if (!searchQuery.trim()) {
      setFilteredCertificates(statusFiltered);
      // 검색어가 없을 때는 마지막 페이지로 이동 (최신 항목 표시)
      if (statusFiltered.length > 0) {
        const ITEMS_PER_PAGE = 10;
        const totalPages = Math.ceil(statusFiltered.length / ITEMS_PER_PAGE);
        setCurrentPage(totalPages > 0 ? totalPages : 1);
      }
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = statusFiltered.filter((cert) => {
      // 요청자
      const userName = cert.userName?.toLowerCase() || '';
      // 고객명
      const customerName = cert.customerName?.toLowerCase() || '';
      // 발주번호
      const orderNumber = cert.orderNumber?.toLowerCase() || '';
      // 제품명 (기존 필드 및 products 배열)
      const productName = cert.productName?.toLowerCase() || '';
      const productsProductNames = cert.products?.map(p => p.productName?.toLowerCase() || '').join(' ') || '';
      // 제품코드 (기존 필드 및 products 배열)
      const productCode = cert.productCode?.toLowerCase() || '';
      const productsProductCodes = cert.products?.map(p => p.productCode?.toLowerCase() || '').join(' ') || '';
      // 상태
      const statusLabel = STATUS_LABELS[cert.status]?.toLowerCase() || cert.status || '';

      return (
        userName.includes(query) ||
        customerName.includes(query) ||
        orderNumber.includes(query) ||
        productName.includes(query) ||
        productsProductNames.includes(query) ||
        productCode.includes(query) ||
        productsProductCodes.includes(query) ||
        statusLabel.includes(query) ||
        cert.status.includes(query)
      );
    });

    setFilteredCertificates(filtered);
    setCurrentPage(1);
  }, [searchQuery, certificates, searchParams]);

  // 페이지네이션
  useEffect(() => {
    const ITEMS_PER_PAGE = 10; // 명시적으로 10개로 설정
    if (filteredCertificates.length === 0) {
      setDisplayedCertificates([]);
      return;
    }
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    // endIndex는 startIndex + ITEMS_PER_PAGE로 계산 (slice는 endIndex를 포함하지 않으므로)
    const endIndex = startIndex + ITEMS_PER_PAGE;
    // slice는 startIndex부터 endIndex-1까지 반환하므로, endIndex는 포함하지 않음
    // 예: slice(0, 10)은 인덱스 0~9까지 (총 10개) 반환
    const sliced = filteredCertificates.slice(startIndex, endIndex);
    // 각 페이지에서 위쪽이 최신 번호가 되도록 역순으로 뒤집기
    const reversed = [...sliced].reverse();
    setDisplayedCertificates(reversed);
  }, [filteredCertificates, currentPage]);

  // 성공 메시지 자동 제거
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        setSuccess('');
      }, 3000); // 3초 후 자동으로 사라짐
      
      return () => clearTimeout(timer);
    }
  }, [success]);

  const totalPages = Math.ceil(filteredCertificates.length / itemsPerPage);

  const handleDownload = async (certificate: Certificate) => {
    if (!certificate.certificateFile?.url) {
      return;
    }

    try {
      // CERTIFICATE NO. 가져오기
      const certificateNo = certificate.materialTestCertificate?.certificateNo || 'CERT';
      
      // CERTIFICATE NO.를 기반으로 파일명 생성 (특수문자 제거)
      const sanitizedCertificateNo = certificateNo.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `MATERIAL_TEST_CERTIFICATE_${sanitizedCertificateNo}.pdf`;
      
      // storagePath가 있으면 getDownloadURL을 사용하여 새로운 다운로드 URL 가져오기
      let downloadUrl = certificate.certificateFile.url;
      if (certificate.certificateFile.storagePath) {
        try {
          const storageRef = ref(storage, certificate.certificateFile.storagePath);
          downloadUrl = await getDownloadURL(storageRef);
        } catch (urlError) {
          console.warn('getDownloadURL 실패, 기존 URL 사용:', urlError);
          // 기존 URL 사용
        }
      }
      
      // 캐시된 구버전 PDF가 열리지 않도록 cache-busting 쿼리 추가
      const cacheBustedDownloadUrl = `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;

      // CORS 문제를 피하기 위해 fetch를 사용하지 않고 직접 a 태그로 다운로드 시도
      // 외부 URL의 경우 브라우저가 download 속성을 무시할 수 있지만, 시도해봄
      const link = document.createElement('a');
      link.href = cacheBustedDownloadUrl;
      link.download = fileName;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // 브라우저가 download 속성을 무시하고 새 창에서 열 수 있음
      // 이 경우 파일명은 지정할 수 없지만, 다운로드는 가능함
    } catch (error) {
      console.error('다운로드 오류:', error);
      // 최종 대체: 기존 방식으로 새 창에서 열기
      window.open(certificate.certificateFile?.url, '_blank');
    }
  };

  const handleApprove = (certificate: Certificate) => {
    setApprovingCertificate(certificate);
    // 기존 값이 있으면 설정
    setApprovalForm({
      requestedCompletionDate: certificate.requestedCompletionDate
        ? formatDateShort(certificate.requestedCompletionDate).replace(/\//g, '-')
        : '',
    });
  };

  const handleApproveSubmit = async () => {
    if (!approvingCertificate) return;

    if (!approvalForm.requestedCompletionDate.trim()) {
      setError('완료예정일을 입력해주세요.');
      return;
    }

    setApproving(true);
    setError('');
    setSuccess('');

    try {
      // 날짜 유효성 검사
      const dateObj = new Date(approvalForm.requestedCompletionDate);
      if (isNaN(dateObj.getTime())) {
        setError('유효하지 않은 날짜 형식입니다.');
        setApproving(false);
        return;
      }
      
      const requestedCompletionDate = Timestamp.fromDate(dateObj);
      
      const updateData: Record<string, unknown> = {
        status: 'in_progress',
        requestedCompletionDate: requestedCompletionDate,
        updatedAt: Timestamp.now(),
        updatedBy: 'admin',
      };

      await updateDoc(doc(db, 'certificates', approvingCertificate.id), updateData);

      // 모달 닫기
      setApprovingCertificate(null);
      setApprovalForm({ requestedCompletionDate: '' });
      setSuccess('성적서요청을 확인하였습니다.');
    } catch (error) {
      console.error('성적서 승인 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`성적서 확인에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setApproving(false);
    }
  };

  const handleStatusChange = async (certificate: Certificate, newStatus: CertificateStatus) => {
    if (!certificate) return;

    setUpdatingStatus(true);
    setError('');
    setSuccess('');

    try {
      const updateData: Record<string, unknown> = {
        status: newStatus,
        updatedAt: Timestamp.now(),
        updatedBy: 'admin',
      };

      if (newStatus === 'completed') {
        updateData.completedAt = Timestamp.now();
        updateData.completedBy = 'admin';
      }

      await updateDoc(doc(db, 'certificates', certificate.id), updateData);
      setSuccess('상태가 성공적으로 변경되었습니다.');
    } catch (error) {
      console.error('상태 변경 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`상태 변경에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedCertificate || !certificateFile) {
      setError('성적서 파일을 선택해주세요.');
      return;
    }

    setUploadingFile(true);
    setError('');
    setSuccess('');

    try {
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 15);
      const fileName = `certificate_${selectedCertificate.id}_${timestamp}_${randomId}_${certificateFile.name}`;
      const filePath = `certificates/${selectedCertificate.id}/${fileName}`;
      
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, certificateFile);
      const downloadURL = await getDownloadURL(storageRef);
      
      const certificateAttachment: CertificateAttachment = {
        name: certificateFile.name,
        url: downloadURL,
        size: certificateFile.size,
        type: certificateFile.type,
        uploadedAt: new Date(),
        uploadedBy: 'admin',
      };

      await updateDoc(doc(db, 'certificates', selectedCertificate.id), {
        certificateFile: certificateAttachment,
        status: 'completed',
        completedAt: Timestamp.now(),
        completedBy: 'admin',
        updatedAt: Timestamp.now(),
        updatedBy: 'admin',
      });

      setSuccess('성적서 파일이 성공적으로 업로드되었습니다.');
      setCertificateFile(null);
      setSelectedCertificate(null);
    } catch (error) {
      console.error('파일 업로드 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`파일 업로드에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDelete = async (certificate: Certificate) => {
    const certificateName = certificate.productName || certificate.customerName || '제품명 없음';
    const confirmMessage = certificate.certificateFile?.storagePath
      ? `정말로 "${certificateName}" 성적서 요청을 삭제하시겠습니까?\n연결된 PDF 파일도 Storage에서 삭제됩니다.`
      : `정말로 "${certificateName}" 성적서 요청을 삭제하시겠습니까?`;
    
    if (!confirm(confirmMessage)) {
      return;
    }

    setDeletingId(certificate.id);
    try {
      // Storage에서 PDF 파일 삭제 (있는 경우)
      if (certificate.certificateFile?.storagePath) {
        try {
          console.log('[삭제] Storage에서 PDF 파일 삭제 시도:', certificate.certificateFile.storagePath);
          const fileRef = ref(storage, certificate.certificateFile.storagePath);
          await deleteObject(fileRef);
          console.log('[삭제] ✅ Storage PDF 파일 삭제 완료');
        } catch (storageError) {
          // Storage 삭제 실패해도 Firestore 삭제는 계속 진행
          console.warn('[삭제] ⚠️ Storage PDF 파일 삭제 실패 (계속 진행):', storageError);
        }
      }
      
      // Firestore에서 성적서 문서 삭제
      await deleteDoc(doc(db, 'certificates', certificate.id));
      console.log('[삭제] ✅ Firestore 문서 삭제 완료');
    } catch (error) {
      console.error('성적서 삭제 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`성적서 삭제에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setDeletingId(null);
    }
  };

  // 전체 선택/해제
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(displayedCertificates.map(c => c.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  // 개별 선택/해제
  const handleSelectOne = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  };

  // 선택된 항목들 일괄 삭제
  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) {
      setError('삭제할 항목을 선택해주세요.');
      return;
    }

    const certificatesToDelete = certificates.filter(c => selectedIds.has(c.id));
    const hasPdfFiles = certificatesToDelete.some(c => c.certificateFile?.storagePath);
    const confirmMessage = hasPdfFiles
      ? `선택한 ${selectedIds.size}개의 성적서 요청을 삭제하시겠습니까?\n연결된 PDF 파일도 Storage에서 삭제됩니다.`
      : `선택한 ${selectedIds.size}개의 성적서 요청을 삭제하시겠습니까?`;

    if (!confirm(confirmMessage)) {
      return;
    }

    setIsDeletingMultiple(true);
    setError('');
    
    try {
      // Storage에서 PDF 파일 삭제 및 Firestore 문서 삭제
      const deletePromises = Array.from(selectedIds).map(async (id) => {
        const certificate = certificates.find(c => c.id === id);
        
        // Storage에서 PDF 파일 삭제 (있는 경우)
        if (certificate?.certificateFile?.storagePath) {
          try {
            console.log(`[일괄 삭제] Storage에서 PDF 파일 삭제 시도: ${certificate.certificateFile.storagePath}`);
            const fileRef = ref(storage, certificate.certificateFile.storagePath);
            await deleteObject(fileRef);
            console.log(`[일괄 삭제] ✅ PDF 파일 삭제 완료: ${id}`);
          } catch (storageError) {
            // Storage 삭제 실패해도 Firestore 삭제는 계속 진행
            console.warn(`[일괄 삭제] ⚠️ PDF 파일 삭제 실패 (계속 진행): ${id}`, storageError);
          }
        }
        
        // Firestore에서 성적서 문서 삭제
        await deleteDoc(doc(db, 'certificates', id));
      });
      
      await Promise.all(deletePromises);
      console.log(`[일괄 삭제] ✅ ${selectedIds.size}개 성적서 삭제 완료`);
      setSelectedIds(new Set());
      setSuccess(`${selectedIds.size}개의 성적서 요청이 삭제되었습니다.`);
    } catch (error) {
      console.error('성적서 일괄 삭제 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`성적서 삭제에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setIsDeletingMultiple(false);
    }
  };

  const handleRefresh = () => {
    setLoadingCertificates(true);
    setError('');
    window.location.reload();
  };

  if (loadingCertificates) {
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
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">성적서 목록</h1>
          <p className="text-gray-600 mt-2 text-sm sm:text-base">
            전체 성적서 요청을 확인하고 관리할 수 있습니다
          </p>
        </div>
        <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 sm:gap-3 sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loadingCertificates}
            className="whitespace-nowrap shrink-0"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            새로고침
          </Button>
          <Link href="/admin/certificate/request" className="shrink-0">
            <Button variant="primary" size="sm" className="whitespace-nowrap shrink-0">
              성적서요청 등록
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-2 border-red-400 text-red-800 px-6 py-4 rounded-lg shadow-md mb-6">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-semibold">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border-2 border-green-400 text-green-800 px-6 py-4 rounded-lg shadow-md mb-6">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="font-semibold">{success}</p>
          </div>
        </div>
      )}

      {/* 검색 입력 필드 및 선택된 항목 삭제 버튼 */}
      <div className="mb-6 flex items-center gap-4">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="요청자, 고객명, 발주번호, 제품명, 제품코드, 상태 검색..."
            className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 pl-10 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          />
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {selectedIds.size > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeleteSelected}
            disabled={isDeletingMultiple || updatingStatus || approving}
            className="text-red-600 border-red-300 hover:bg-red-50"
          >
            {isDeletingMultiple ? '삭제 중...' : `선택한 ${selectedIds.size}개 삭제`}
          </Button>
        )}
      </div>

      {certificates.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">등록된 성적서 요청이 없습니다</h3>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-gray-200 table-auto">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-[7.68px] py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-12">
                          <input
                            type="checkbox"
                            checked={displayedCertificates.length > 0 && displayedCertificates.every(c => selectedIds.has(c.id))}
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-12">번호</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[60px]">요청자</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-20">요청일</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[38px]">고객명</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[100px]">발주번호</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[100px]">제품명</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[100px]">제품코드</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-16">수량</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-20">완료요청일</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-20">완료예정일</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-20">완료일</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-16">첨부</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-16">비고</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[60px]">상태</th>
                        <th className="px-[7.68px] py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[180px]">관리</th>
                      </tr>
                    </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayedCertificates.map((certificate, idx) => {
                    const itemsPerPageValue = 10; // 명시적으로 10개로 설정
                    // 역순으로 표시되므로, idx는 역순 인덱스 (0이 마지막 항목)
                    const reversedIdx = displayedCertificates.length - 1 - idx;
                    const absoluteIndex = (currentPage - 1) * itemsPerPageValue + reversedIdx;
                    const rowNumber = absoluteIndex + 1; // 1번부터 시작
                    return (
                      <tr key={certificate.id} className="hover:bg-gray-50">
                        <td className="px-[7.68px] py-3 text-center w-12">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(certificate.id)}
                            onChange={(e) => handleSelectOne(certificate.id, e.target.checked)}
                            disabled={deletingId === certificate.id || updatingStatus || approving || isDeletingMultiple}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-[7.68px] py-3 text-xs text-gray-900 text-center w-12">
                          {rowNumber}
                        </td>
                        <td className="px-[7.68px] py-3 min-w-[60px]">
                          <div className="text-xs text-gray-900 truncate" title={certificate.userName}>{certificate.userName}</div>
                        </td>
                        <td className="px-[7.68px] py-3 w-20">
                          <div className="text-xs text-gray-900">{formatDateShort(certificate.requestDate)}</div>
                        </td>
                        <td className="px-[7.68px] py-3 min-w-[38px]">
                          <div className="text-xs text-gray-900 whitespace-nowrap" title={certificate.customerName || '-'}>{truncateText(certificate.customerName || '-')}</div>
                        </td>
                        <td className="px-[7.68px] py-3 min-w-[100px]">
                          <div className="text-xs text-gray-900 whitespace-nowrap" title={certificate.orderNumber || '-'}>{truncateText(certificate.orderNumber || '-')}</div>
                        </td>
                        <td className="px-[7.68px] py-3 min-w-[100px]">
                          <div className="text-xs font-medium text-gray-900 whitespace-nowrap" title={certificate.productName || '-'}>{truncateText(certificate.productName || '-')}</div>
                        </td>
                        <td className="px-[7.68px] py-3 min-w-[100px]">
                          <div className="text-xs text-gray-900 whitespace-nowrap" title={certificate.productCode || '-'}>{truncateText(certificate.productCode || '-')}</div>
                        </td>
                        <td className="px-[7.68px] py-3 w-16">
                          <div className="text-xs text-gray-900 text-center">{certificate.quantity ? certificate.quantity.toLocaleString() : '-'}</div>
                        </td>
                        <td className="px-[7.68px] py-3 w-20">
                          <div className="text-xs text-gray-900">{certificate.requestedCompletionDate ? formatDateShort(certificate.requestedCompletionDate) : '-'}</div>
                        </td>
                        <td className="px-[7.68px] py-3 w-20">
                          <div className="text-xs text-gray-900">
                            {certificate.status === 'in_progress' || certificate.status === 'completed' 
                              ? (certificate.requestedCompletionDate ? formatDateShort(certificate.requestedCompletionDate) : '-')
                              : '-'}
                          </div>
                        </td>
                        <td className="px-[7.68px] py-3 w-20">
                          <div className="text-xs text-gray-900">{certificate.completedAt ? formatDateShort(certificate.completedAt) : '-'}</div>
                        </td>
                        <td className="px-[7.68px] py-3 w-16">
                          {certificate.attachments && certificate.attachments.length > 0 ? (
                            <button
                              onClick={() => setAttachmentModalCertificate(certificate)}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                            >
                              파일
                            </button>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-[7.68px] py-3 w-16">
                          {certificate.memo ? (
                            <button
                              onClick={() => setMemoModalCertificate(certificate)}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                              title={certificate.memo}
                            >
                              보기
                            </button>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-[7.68px] py-3 min-w-[60px]">
                          <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap ${STATUS_COLORS[certificate.status]}`}>
                            {STATUS_LABELS[certificate.status]}
                          </span>
                        </td>
                        <td className="px-[7.68px] py-3 min-w-[180px]">
                          <div className="flex items-center gap-1 whitespace-nowrap">
                            {certificate.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove(certificate)}
                                  className="text-green-600 hover:text-green-800 text-xs font-medium"
                                  disabled={deletingId === certificate.id || updatingStatus || approving}
                                  title="확인"
                                >
                                  확인
                                </button>
                                <span className="text-gray-300 text-xs">|</span>
                              </>
                            )}
                            {certificate.certificateFile && (
                              <>
                                <button
                                  onClick={() => handleDownload(certificate)}
                                  className="text-green-600 hover:text-green-800 text-xs font-medium"
                                  disabled={deletingId === certificate.id || updatingStatus || approving}
                                  title="다운로드"
                                >
                                  다운로드
                                </button>
                                <span className="text-gray-300 text-xs">|</span>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    console.log('수정 버튼 클릭됨', { 
                                      certificateId: certificate.id, 
                                      hasId: !!certificate.id,
                                      deletingId,
                                      updatingStatus,
                                      approving
                                    });
                                    if (!certificate.id) {
                                      console.error('수정 버튼 클릭: certificate.id가 없습니다', certificate);
                                      alert('성적서 ID가 없습니다. 페이지를 새로고침해주세요.');
                                      return;
                                    }
                                    const url = `/admin/certificate/edit/${certificate.id}`;
                                    console.log('이동할 URL:', url);
                                    try {
                                      router.push(url);
                                    } catch (error) {
                                      console.error('router.push 오류:', error);
                                      // router.push 실패 시 window.location 사용
                                      window.location.href = url;
                                    }
                                  }}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                  disabled={deletingId === certificate.id || updatingStatus || approving}
                                  title="성적서 수정"
                                >
                                  수정
                                </button>
                                <span className="text-gray-300 text-xs">|</span>
                              </>
                            )}
                            {certificate.status !== 'pending' && !certificate.certificateFile && (
                              <>
                                <button
                                  onClick={() => router.push(`/admin/certificate/create?id=${certificate.id}`)}
                                  className="text-purple-600 hover:text-purple-800 text-xs font-medium"
                                  disabled={deletingId === certificate.id || updatingStatus || approving}
                                  title="성적서 작성"
                                >
                                  성적서 작성
                                </button>
                                <span className="text-gray-300 text-xs">|</span>
                              </>
                            )}
                            {!certificate.certificateFile && (
                              <>
                                <button
                                  onClick={() => router.push(`/admin/certificate/request?id=${certificate.id}`)}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                  disabled={deletingId === certificate.id || updatingStatus || approving}
                                  title="수정"
                                >
                                  수정
                                </button>
                                <span className="text-gray-300 text-xs">|</span>
                              </>
                            )}
                            <button
                              onClick={() => handleDelete(certificate)}
                              className="text-red-600 hover:text-red-800 text-xs font-medium"
                              disabled={deletingId === certificate.id || updatingStatus || approving}
                              title="삭제"
                            >
                              {deletingId === certificate.id ? '삭제 중...' : '삭제'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
      </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs sm:text-sm text-gray-700 min-w-0">
                {searchQuery ? (
                  <>
                    검색 결과 <span className="font-medium">{filteredCertificates.length}</span>건 중{' '}
                    <span className="font-medium">
                      {(currentPage - 1) * itemsPerPage + 1}
                    </span>
                    -
                    <span className="font-medium">
                      {Math.min(currentPage * itemsPerPage, filteredCertificates.length)}
                    </span>
                    건 표시 (전체 {certificates.length}건)
                  </>
                ) : (
                  <>
                    전체 <span className="font-medium">{filteredCertificates.length}</span>건 중{' '}
                    <span className="font-medium">
                      {(currentPage - 1) * itemsPerPage + 1}
                    </span>
                    -
                    <span className="font-medium">
                      {Math.min(currentPage * itemsPerPage, filteredCertificates.length)}
                    </span>
                    건 표시
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end sm:flex-nowrap w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 min-w-[4.5rem] justify-center whitespace-nowrap"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  이전
                </Button>
                <div className="flex flex-wrap items-center justify-center gap-1 max-w-full">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[2.25rem] shrink-0 px-2.5 py-1 text-sm rounded whitespace-nowrap ${
                        currentPage === page
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 min-w-[4.5rem] justify-center whitespace-nowrap"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  다음
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 성적서 상세 및 파일 업로드 모달 */}
      {selectedCertificate && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30" 
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedCertificate(null);
              setCertificateFile(null);
            }
          }}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col relative" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-900">성적서 상세</h3>
              <button
                onClick={() => {
                  setSelectedCertificate(null);
                  setCertificateFile(null);
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">고객명</label>
                  <p className="text-sm text-gray-900">{selectedCertificate.customerName || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">발주번호</label>
                  <p className="text-sm text-gray-900">{selectedCertificate.orderNumber || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">요청자</label>
                  <p className="text-sm text-gray-900">{selectedCertificate.userName}</p>
                  {selectedCertificate.userCompany && (
                    <p className="text-xs text-gray-500">{selectedCertificate.userCompany}</p>
                  )}
                  <p className="text-xs text-gray-500">{selectedCertificate.userEmail}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">제품명</label>
                  <p className="text-sm text-gray-900">{selectedCertificate.productName || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">제품코드</label>
                  <p className="text-sm text-gray-900">{selectedCertificate.productCode || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">수량</label>
                  <p className="text-sm text-gray-900">{selectedCertificate.quantity ? selectedCertificate.quantity.toLocaleString() : '-'}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                    <select
                      value={selectedCertificate.status}
                      onChange={(e) => handleStatusChange(selectedCertificate, e.target.value as CertificateStatus)}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                      disabled={updatingStatus}
                    >
                      <option value="pending">대기</option>
                      <option value="in_progress">진행</option>
                      <option value="completed">완료</option>
                      <option value="cancelled">취소</option>
                    </select>
                  </div>
                </div>
                {selectedCertificate.memo && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">메모</label>
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{selectedCertificate.memo}</p>
                  </div>
                )}
                {selectedCertificate.certificateFile && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">성적서 파일</label>
                    <a
                      href={selectedCertificate.certificateFile.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 text-sm underline"
                    >
                      {selectedCertificate.certificateFile.name}
                    </a>
                  </div>
                )}
                {selectedCertificate.status !== 'completed' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">성적서 파일 업로드</label>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setCertificateFile(file);
                        }
                      }}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    />
                    {certificateFile && (
                      <p className="mt-2 text-sm text-gray-600">선택된 파일: {certificateFile.name}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedCertificate(null);
                  setCertificateFile(null);
                }}
                disabled={uploadingFile || updatingStatus}
              >
                닫기
              </Button>
              {selectedCertificate.status !== 'completed' && certificateFile && (
                <Button
                  variant="primary"
                  onClick={handleFileUpload}
                  disabled={uploadingFile || updatingStatus}
                  loading={uploadingFile}
                >
                  파일 업로드
                </Button>
              )}
            </div>
          </div>
      </div>
      )}

      {/* 첨부 파일 모달 */}
      {attachmentModalCertificate && attachmentModalCertificate.attachments && attachmentModalCertificate.attachments.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30" onClick={() => setAttachmentModalCertificate(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col relative" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-900">첨부 파일</h3>
              <button
                onClick={() => setAttachmentModalCertificate(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <div className="space-y-2">
                {attachmentModalCertificate.attachments.map((file, index) => (
                  <a
                    key={index}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50"
                  >
                    <div className="flex items-center">
                      <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-blue-600 hover:underline">{file.name}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {file.size ? `${(file.size / 1024).toFixed(1)} KB` : ''}
                    </span>
                  </a>
                ))}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end sticky bottom-0 bg-white">
              <Button
                variant="primary"
                onClick={() => setAttachmentModalCertificate(null)}
              >
                닫기
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 비고 모달 */}
      {memoModalCertificate && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30" 
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setMemoModalCertificate(null);
            }
          }}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col relative" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-900">비고</h3>
              <button
                onClick={() => setMemoModalCertificate(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">{memoModalCertificate.memo}</div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end sticky bottom-0 bg-white">
              <Button
                variant="primary"
                onClick={() => setMemoModalCertificate(null)}
              >
                닫기
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 승인 모달 */}
      {approvingCertificate && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30" 
          onMouseDown={(e) => {
            // 모달 내부가 아닌 배경만 클릭했을 때만 모달 닫기
            if (e.target === e.currentTarget) {
              setApprovingCertificate(null);
            }
          }}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 flex flex-col relative" 
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-900">성적서 확인</h3>
              <button
                onClick={() => {
                  setApprovingCertificate(null);
                  setApprovalForm({ requestedCompletionDate: '' });
                  setError('');
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                disabled={approving}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div 
              className="px-6 py-4 overflow-y-auto flex-1"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600 mb-2">고객명: <span className="font-medium text-gray-900">{approvingCertificate.customerName || '-'}</span></p>
                </div>
                {approvingCertificate.requestedCompletionDate && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">완료요청일: <span className="font-medium text-gray-900">{formatDateShort(approvingCertificate.requestedCompletionDate)}</span></p>
                  </div>
                )}
                <div onClick={(e) => e.stopPropagation()}>
                  <label htmlFor="requestedCompletionDate" className="block text-sm font-medium text-gray-700 mb-2">
                    완료예정일: *
                  </label>
                  <input
                    type="date"
                    id="requestedCompletionDate"
                    value={approvalForm.requestedCompletionDate}
                    onChange={(e) => {
                      e.stopPropagation();
                      setApprovalForm({ ...approvalForm, requestedCompletionDate: e.target.value });
                      if (error) setError('');
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.stopPropagation()}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    disabled={approving}
                    min={today}
                    required
                  />
                </div>
              </div>
            </div>
            <div 
              className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Button
                variant="outline"
                onClick={() => {
                  setApprovingCertificate(null);
                  setApprovalForm({ requestedCompletionDate: '' });
                  setError('');
                }}
                disabled={approving}
              >
                취소
              </Button>
              <Button
                variant="primary"
                onClick={handleApproveSubmit}
                disabled={approving}
                loading={approving}
              >
                저장
              </Button>
            </div>
      </div>
        </div>
      )}
    </div>
  );
}
