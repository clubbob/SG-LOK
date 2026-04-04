"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';
import { collection, query, where, doc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Certificate, CertificateStatus, CertificateType } from '@/types';
import { formatDateShort } from '@/lib/utils';

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

function CertificateListPageContent() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loadingCertificates, setLoadingCertificates] = useState(true);
  const [error, setError] = useState('');
  const [displayedCertificates, setDisplayedCertificates] = useState<Certificate[]>([]);
  const itemsPerPage = 10; // 명시적으로 10개로 설정
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedMemo, setSelectedMemo] = useState<{ id: string; memo: string } | null>(null);
  const [selectedCertificate, setSelectedCertificate] = useState<Certificate | null>(null);
  const [selectedCertificateForView, setSelectedCertificateForView] = useState<Certificate | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredCertificates, setFilteredCertificates] = useState<Certificate[]>([]);

  // 인증 확인
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  // 성적서 목록: 로그인 사용자 본인이 요청한 건만 조회
  useEffect(() => {
    if (!isAuthenticated) {
      setLoadingCertificates(false);
      setCertificates([]);
      return;
    }
    if (!userProfile?.id) {
      setLoadingCertificates(true);
      return;
    }

    setLoadingCertificates(true);
    setError('');
    
    const certificatesRef = collection(db, 'certificates');
    const q = query(certificatesRef, where('userId', '==', userProfile.id));
    
    const unsubscribeSnapshot = onSnapshot(
      q,
      (querySnapshot) => {
        const certificatesData: Certificate[] = [];
        
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          
          // 생산요청 데이터 필터링
          if (data.productionReason) {
            return;
          }
          
          // products 배열이 있으면 첫 번째 제품 정보를 단일 필드로 매핑 (하위 호환성)
          const firstProduct = data.products && data.products.length > 0 ? data.products[0] : null;
          
          certificatesData.push({
            id: doc.id,
            userId: data.userId || 'admin',
            userName: data.userName || '관리자',
            userEmail: data.userEmail || '',
            userCompany: data.userCompany || '',
            customerName: data.customerName,
            orderNumber: data.orderNumber,
            products: data.products || [],
            productName: firstProduct?.productName || data.productName,
            productCode: firstProduct?.productCode || data.productCode,
            lotNumber: firstProduct?.lotNumber || data.lotNumber,
            quantity: firstProduct?.quantity || data.quantity,
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
        
        // 모든 성적서 표시 (필터링 제거)
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

    // 컴포넌트 언마운트 시 구독 해제
    return () => {
      unsubscribeSnapshot();
    };
  }, [isAuthenticated, userProfile?.id]);

  // 상태(URL) + 검색 필터링 (관리자 성적서 목록과 동일한 status 쿼리)
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
      if (statusFiltered.length > 0) {
        const ITEMS_PER_PAGE = 10;
        const totalPages = Math.ceil(statusFiltered.length / ITEMS_PER_PAGE);
        setCurrentPage(totalPages > 0 ? totalPages : 1);
      } else {
        setCurrentPage(1);
      }
      return;
    }

    const q = searchQuery.toLowerCase().trim();
    const filtered = statusFiltered.filter((cert) => {
      const userName = cert.userName?.toLowerCase() || '';
      const customerName = cert.customerName?.toLowerCase() || '';
      const orderNumber = cert.orderNumber?.toLowerCase() || '';
      const productName = cert.productName?.toLowerCase() || '';
      const productsProductNames = cert.products?.map(p => p.productName?.toLowerCase() || '').join(' ') || '';
      const productCode = cert.productCode?.toLowerCase() || '';
      const productsProductCodes = cert.products?.map(p => p.productCode?.toLowerCase() || '').join(' ') || '';
      const statusLabel = STATUS_LABELS[cert.status]?.toLowerCase() || cert.status || '';

      return (
        userName.includes(q) ||
        customerName.includes(q) ||
        orderNumber.includes(q) ||
        productName.includes(q) ||
        productsProductNames.includes(q) ||
        productCode.includes(q) ||
        productsProductCodes.includes(q) ||
        statusLabel.includes(q) ||
        cert.status.includes(q)
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

  const totalPages = Math.ceil(filteredCertificates.length / itemsPerPage);

  const handleEdit = (certificate: Certificate) => {
    router.push(`/certificate/request?id=${certificate.id}`);
  };

  const handleDelete = async (certificate: Certificate) => {
    if (userProfile?.id && certificate.userId !== userProfile.id) {
      return;
    }
    if (!confirm(`정말로 "${certificate.productName || '제품명 없음'}" 성적서 요청을 삭제하시겠습니까?`)) {
      return;
    }

    setDeletingId(certificate.id);
    try {
      await deleteDoc(doc(db, 'certificates', certificate.id));
      // 실시간 업데이트로 자동 새로고침됨
    } catch (error) {
      console.error('성적서 삭제 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`성적서 삭제에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = (certificate: Certificate) => {
    if (certificate.certificateFile?.url) {
      window.open(certificate.certificateFile.url, '_blank');
    }
  };

  if (loading || loadingCertificates) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-12">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">성적서 목록</h1>
              <p className="text-gray-600 text-sm sm:text-base">요청한 성적서를 확인하고 관리할 수 있습니다</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto sm:flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto justify-center whitespace-nowrap"
                onClick={() => {
                  // 실시간 업데이트가 작동 중이지만, 사용자 요청에 따라 페이지 새로고침
                  window.location.reload();
                }}
                disabled={loadingCertificates}
              >
                새로고침
              </Button>
              <Link href="/certificate/request" className="w-full sm:w-auto">
                <Button variant="primary" size="sm" className="w-full sm:w-auto justify-center whitespace-nowrap">
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

          {/* 검색 입력 필드 */}
          <div className="mb-6">
            <div className="relative">
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
          </div>

          {certificates.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center">
              <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">등록된 성적서 요청이 없습니다</h3>
              <p className="text-gray-600 mb-4">새로운 성적서 요청을 등록해보세요.</p>
              <Link href="/certificate/request">
                <Button variant="primary">성적서요청 등록</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full divide-y divide-gray-200 table-auto">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12 whitespace-nowrap">번호</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[60px] whitespace-nowrap">요청자</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20 whitespace-nowrap">요청일</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[64px] whitespace-nowrap">고객명</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] whitespace-nowrap">발주번호</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] whitespace-nowrap">제품명</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] whitespace-nowrap">제품코드</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16 whitespace-nowrap">수량</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px] whitespace-nowrap">완료요청일</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px] whitespace-nowrap">완료예정일</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20 whitespace-nowrap">완료일</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16 whitespace-nowrap">첨부</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16 whitespace-nowrap">비고</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[70px] whitespace-nowrap">상태</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px] whitespace-nowrap">관리</th>
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
                            <td className="px-1 py-3 text-xs text-gray-900 text-center w-12">
                              {rowNumber}
                            </td>
                            <td className="px-1 py-3 min-w-[60px]">
                              <div className="text-xs text-gray-900 truncate" title={certificate.userName || '-'}>{certificate.userName || '-'}</div>
                            </td>
                            <td className="px-1 py-3 w-20">
                              <div className="text-xs text-gray-900 whitespace-nowrap">{formatDateShort(certificate.requestDate)}</div>
                            </td>
                            <td className="px-1 py-3 min-w-[64px]">
                              <div className="text-xs text-gray-900 whitespace-nowrap" title={certificate.customerName || '-'}>{truncateText(certificate.customerName || '-')}</div>
                            </td>
                            <td className="px-1 py-3 min-w-[100px]">
                              <div className="text-xs text-gray-900 whitespace-nowrap" title={certificate.orderNumber || '-'}>{truncateText(certificate.orderNumber || '-')}</div>
                            </td>
                            <td className="px-1 py-3 min-w-[100px]">
                              <div className="text-xs font-medium text-gray-900 whitespace-nowrap" title={certificate.productName || '-'}>{truncateText(certificate.productName || '-')}</div>
                            </td>
                            <td className="px-1 py-3 min-w-[100px]">
                              <div className="text-xs text-gray-900 whitespace-nowrap" title={certificate.productCode || '-'}>{truncateText(certificate.productCode || '-')}</div>
                            </td>
                            <td className="px-1 py-3 w-16">
                              <div className="text-xs text-gray-900 text-center">{certificate.quantity ? certificate.quantity.toLocaleString() : '-'}</div>
                            </td>
                            <td className="px-1 py-3 w-20">
                              <div className="text-xs text-gray-900 whitespace-nowrap">{certificate.requestedCompletionDate ? formatDateShort(certificate.requestedCompletionDate) : '-'}</div>
                            </td>
                            <td className="px-1 py-3 w-20">
                              <div className="text-xs text-gray-900 whitespace-nowrap">
                                {certificate.status === 'in_progress' || certificate.status === 'completed'
                                  ? (certificate.requestedCompletionDate ? formatDateShort(certificate.requestedCompletionDate) : '-')
                                  : '-'}
                              </div>
                            </td>
                            <td className="px-1 py-3 w-20">
                              <div className="text-xs text-gray-900 whitespace-nowrap">{certificate.completedAt ? formatDateShort(certificate.completedAt) : '-'}</div>
                            </td>
                            <td className="px-1 py-3 w-16">
                              {certificate.attachments && certificate.attachments.length > 0 ? (
                                <button
                                  onClick={() => setSelectedCertificate(certificate)}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                >
                                  파일
                                </button>
                              ) : (
                                <span className="text-gray-400 text-xs">-</span>
                              )}
                            </td>
                            <td className="px-1 py-3 w-16">
                              {certificate.memo ? (
                                <button
                                  onClick={() => setSelectedMemo({ id: certificate.id, memo: certificate.memo || '' })}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                  title={certificate.memo}
                                >
                                  보기
                                </button>
                              ) : (
                                <span className="text-gray-400 text-xs">-</span>
                              )}
                            </td>
                            <td className="px-1 py-3 min-w-[70px]">
                              <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap ${STATUS_COLORS[certificate.status]}`}>
                                {STATUS_LABELS[certificate.status]}
                              </span>
                            </td>
                            <td className="px-1 py-3 min-w-[80px]">
                              <div className="flex items-center gap-1 flex-wrap">
                                {certificate.status === 'pending' ? (
                                  <>
                                    <button
                                      onClick={() => handleEdit(certificate)}
                                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                      disabled={deletingId === certificate.id}
                                    >
                                      수정
                                    </button>
                                    <span className="text-gray-300 text-xs">|</span>
                                    <button
                                      onClick={() => handleDelete(certificate)}
                                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                                      disabled={deletingId === certificate.id}
                                    >
                                      {deletingId === certificate.id ? '삭제 중...' : '삭제'}
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {certificate.certificateFile && (
                                      <button
                                        onClick={() => handleDownload(certificate)}
                                        className="text-green-600 hover:text-green-800 text-xs font-medium"
                                      >
                                        다운로드
                                      </button>
                                    )}
                                  </>
                                )}
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

          {/* 첨부 파일 상세 모달 */}
          {selectedCertificate && selectedCertificate.attachments && selectedCertificate.attachments.length > 0 && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30" onClick={() => setSelectedCertificate(null)}>
              <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col relative" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
                  <h3 className="text-lg font-semibold text-gray-900">첨부 파일</h3>
                  <button
                    onClick={() => setSelectedCertificate(null)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="px-6 py-4 overflow-y-auto flex-1">
                  <div className="space-y-2">
                    {selectedCertificate.attachments.map((file, index) => (
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
                    onClick={() => setSelectedCertificate(null)}
                  >
                    닫기
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 성적서 상세 모달 */}
          {selectedCertificateForView && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setSelectedCertificateForView(null)}>
              <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
                  <h3 className="text-lg font-semibold text-gray-900">성적서 상세</h3>
                  <button
                    onClick={() => setSelectedCertificateForView(null)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="px-6 py-4 overflow-y-auto flex-1">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">고객명</label>
                        <p className="text-sm text-gray-900">{selectedCertificateForView.customerName || '-'}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">발주번호</label>
                        <p className="text-sm text-gray-900">{selectedCertificateForView.orderNumber || '-'}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">제품명</label>
                        <p className="text-sm text-gray-900">{selectedCertificateForView.productName || '-'}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">제품코드</label>
                        <p className="text-sm text-gray-900">{selectedCertificateForView.productCode || '-'}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">수량</label>
                        <p className="text-sm text-gray-900">{selectedCertificateForView.quantity ? selectedCertificateForView.quantity.toLocaleString() : '-'}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">요청일</label>
                        <p className="text-sm text-gray-900">{formatDateShort(selectedCertificateForView.requestDate)}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">완료요청일</label>
                        <p className="text-sm text-gray-900">{selectedCertificateForView.requestedCompletionDate ? formatDateShort(selectedCertificateForView.requestedCompletionDate) : '-'}</p>
                      </div>
                      {(selectedCertificateForView.status === 'in_progress' || selectedCertificateForView.status === 'completed') && selectedCertificateForView.requestedCompletionDate && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">완료예정일</label>
                          <p className="text-sm text-gray-900">{formatDateShort(selectedCertificateForView.requestedCompletionDate)}</p>
                        </div>
                      )}
                      {selectedCertificateForView.completedAt && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">완료일</label>
                          <p className="text-sm text-gray-900">{formatDateShort(selectedCertificateForView.completedAt)}</p>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[selectedCertificateForView.status]}`}>
                          {STATUS_LABELS[selectedCertificateForView.status]}
                        </span>
                      </div>
                    </div>
                    {selectedCertificateForView.memo && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">비고</label>
                        <p className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded-md">{selectedCertificateForView.memo}</p>
                      </div>
                    )}
                    {selectedCertificateForView.certificateFile && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">성적서 파일</label>
                        <a
                          href={selectedCertificateForView.certificateFile.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50"
                        >
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-sm text-blue-600 hover:underline">{selectedCertificateForView.certificateFile.name}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {selectedCertificateForView.certificateFile.size ? `${(selectedCertificateForView.certificateFile.size / 1024).toFixed(1)} KB` : ''}
                          </span>
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end sticky bottom-0 bg-white">
                  <Button
                    variant="primary"
                    onClick={() => setSelectedCertificateForView(null)}
                  >
                    닫기
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 비고 상세 모달 */}
          {selectedMemo && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30" onClick={() => setSelectedMemo(null)}>
              <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col relative" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
                  <h3 className="text-lg font-semibold text-gray-900">메모</h3>
                  <button
                    onClick={() => setSelectedMemo(null)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="px-6 py-4 overflow-y-auto flex-1">
                  <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">{selectedMemo.memo}</div>
                </div>
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end sticky bottom-0 bg-white">
                  <Button
                    variant="primary"
                    onClick={() => setSelectedMemo(null)}
                  >
                    닫기
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function CertificateListPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-4 text-gray-600">로딩 중...</p>
          </div>
        </div>
      }
    >
      <CertificateListPageContent />
    </Suspense>
  );
}
