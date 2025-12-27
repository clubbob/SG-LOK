"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { collection, query, getDocs, doc, updateDoc, Timestamp, onSnapshot, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { Certificate, CertificateStatus, CertificateType, CertificateAttachment } from '@/types';
import { formatDateShort } from '@/lib/utils';

const ADMIN_SESSION_KEY = 'admin_session';

const STATUS_LABELS: Record<CertificateStatus, string> = {
  pending: '대기',
  in_progress: '진행중',
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
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loadingCertificates, setLoadingCertificates] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedCertificate, setSelectedCertificate] = useState<Certificate | null>(null);
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [displayedCertificates, setDisplayedCertificates] = useState<Certificate[]>([]);
  const [itemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredCertificates, setFilteredCertificates] = useState<Certificate[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [approvingCertificate, setApprovingCertificate] = useState<Certificate | null>(null);
  const [approvalForm, setApprovalForm] = useState({
    requestedCompletionDate: '',
  });
  const [approving, setApproving] = useState(false);
  
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
          
          certificatesData.push({
            id: doc.id,
            userId: data.userId,
            userName: data.userName,
            userEmail: data.userEmail,
            userCompany: data.userCompany,
            customerName: data.customerName,
            orderNumber: data.orderNumber,
            productName: data.productName,
            productCode: data.productCode,
            lotNumber: data.lotNumber,
            quantity: data.quantity,
            certificateType: data.certificateType || 'quality',
            requestDate: data.requestDate?.toDate() || new Date(),
            requestedCompletionDate: data.requestedCompletionDate?.toDate(),
            status: data.status || 'pending',
            memo: data.memo || '',
            attachments: data.attachments || [],
            certificateFile: data.certificateFile,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            createdBy: data.createdBy,
            updatedBy: data.updatedBy,
            completedAt: data.completedAt?.toDate(),
            completedBy: data.completedBy,
          });
        });
        
        // 클라이언트 사이드 정렬
        certificatesData.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        
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
    if (!searchQuery.trim()) {
      setFilteredCertificates(certificates);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = certificates.filter((cert) => {
      const customerName = cert.customerName?.toLowerCase() || '';
      const orderNumber = cert.orderNumber?.toLowerCase() || '';
      const productName = cert.productName?.toLowerCase() || '';
      const productCode = cert.productCode?.toLowerCase() || '';
      const userName = cert.userName?.toLowerCase() || '';
      const userCompany = cert.userCompany?.toLowerCase() || '';
      const statusLabel = STATUS_LABELS[cert.status]?.toLowerCase() || cert.status || '';

      return (
        customerName.includes(query) ||
        orderNumber.includes(query) ||
        productName.includes(query) ||
        productCode.includes(query) ||
        userName.includes(query) ||
        userCompany.includes(query) ||
        statusLabel.includes(query) ||
        cert.status.includes(query)
      );
    });

    setFilteredCertificates(filtered);
    setCurrentPage(1);
  }, [searchQuery, certificates]);

  // 페이지네이션
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setDisplayedCertificates(filteredCertificates.slice(startIndex, endIndex));
  }, [filteredCertificates, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredCertificates.length / itemsPerPage);

  const handleDownload = (certificate: Certificate) => {
    if (certificate.certificateFile?.url) {
      window.open(certificate.certificateFile.url, '_blank');
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
      const requestedCompletionDate = Timestamp.fromDate(new Date(approvalForm.requestedCompletionDate));
      
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
      setSuccess('성적서가 성공적으로 승인되었습니다.');
    } catch (error) {
      console.error('성적서 승인 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`성적서 승인에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
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
    if (!confirm(`정말로 "${certificate.productName || '제품명 없음'}" 성적서 요청을 삭제하시겠습니까?`)) {
      return;
    }

    setDeletingId(certificate.id);
    try {
      await deleteDoc(doc(db, 'certificates', certificate.id));
    } catch (error) {
      console.error('성적서 삭제 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`성적서 삭제에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setDeletingId(null);
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 whitespace-nowrap">성적서 목록</h1>
          <p className="text-gray-600 mt-2">전체 성적서 요청을 확인하고 관리할 수 있습니다</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loadingCertificates}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            새로고침
          </Button>
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

      {/* 검색 입력 필드 */}
      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="고객명, 발주번호, 제품명, 제품코드, 로트번호, 요청자, 성적서 유형, 상태 검색..."
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
              <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-12">번호</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">요청자</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">요청일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">고객명</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">발주번호</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">제품명</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">제품코드</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">수량</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">완료요청일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">완료예정일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">완료일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">첨부</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">비고</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">상태</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">관리</th>
                      </tr>
                    </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayedCertificates.map((certificate, idx) => {
                    const absoluteIndex = (currentPage - 1) * itemsPerPage + idx;
                    const rowNumber = filteredCertificates.length - absoluteIndex;
                    return (
                      <tr key={certificate.id} className="hover:bg-gray-50">
                        <td className="px-3 py-4 text-sm text-gray-900 whitespace-nowrap text-center w-12">
                          {rowNumber}
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{certificate.userName}</div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{formatDateShort(certificate.requestDate)}</div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{certificate.customerName || '-'}</div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{certificate.orderNumber || '-'}</div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{certificate.productName || '-'}</div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{certificate.productCode || '-'}</div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{certificate.quantity ? certificate.quantity.toLocaleString() : '-'}</div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{certificate.requestedCompletionDate ? formatDateShort(certificate.requestedCompletionDate) : '-'}</div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {certificate.status === 'in_progress' || certificate.status === 'completed' 
                              ? (certificate.requestedCompletionDate ? formatDateShort(certificate.requestedCompletionDate) : '-')
                              : '-'}
                          </div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{certificate.completedAt ? formatDateShort(certificate.completedAt) : '-'}</div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          {certificate.attachments && certificate.attachments.length > 0 ? (
                            <button
                              onClick={() => setSelectedCertificate(certificate)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              파일 ({certificate.attachments.length})
                            </button>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          {certificate.memo ? (
                            <button
                              onClick={() => setSelectedCertificate(certificate)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium truncate max-w-[100px]"
                              title={certificate.memo}
                            >
                              보기
                            </button>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[certificate.status]}`}>
                            {STATUS_LABELS[certificate.status]}
                          </span>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {certificate.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove(certificate)}
                                  className="text-green-600 hover:text-green-800 text-sm font-medium"
                                  disabled={deletingId === certificate.id || updatingStatus || approving}
                                  title="승인"
                                >
                                  승인
                                </button>
                                <span className="text-gray-300">|</span>
                              </>
                            )}
                            {certificate.certificateFile && (
                              <>
                                <button
                                  onClick={() => handleDownload(certificate)}
                                  className="text-green-600 hover:text-green-800 text-sm font-medium"
                                  disabled={deletingId === certificate.id || updatingStatus || approving}
                                  title="다운로드"
                                >
                                  다운로드
                                </button>
                                <span className="text-gray-300">|</span>
                              </>
                            )}
                            <button
                              onClick={() => router.push(`/admin/certificate/request?id=${certificate.id}`)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                              disabled={deletingId === certificate.id || updatingStatus || approving}
                              title="수정"
                            >
                              수정
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => handleDelete(certificate)}
                              className="text-red-600 hover:text-red-800 text-sm font-medium"
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
            <div className="mt-6 flex items-center justify-between">
              <div className="text-sm text-gray-700">
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
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  이전
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1 text-sm rounded ${
                        currentPage === page
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
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
                      <option value="in_progress">진행중</option>
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
              <h3 className="text-lg font-semibold text-gray-900">성적서 승인</h3>
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
