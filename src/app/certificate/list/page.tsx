"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';
import { collection, query, getDocs, Timestamp, doc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Certificate, CertificateStatus, CertificateType } from '@/types';
import { formatDateShort } from '@/lib/utils';

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

export default function CertificateListPage() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loadingCertificates, setLoadingCertificates] = useState(true);
  const [error, setError] = useState('');
  const [displayedCertificates, setDisplayedCertificates] = useState<Certificate[]>([]);
  const [itemsPerPage] = useState(10);
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

  // 페이지 진입 시 자동 새로고침 (한 번만 실행)
  useEffect(() => {
    if (isAuthenticated && !loading) {
      // sessionStorage를 사용하여 이 세션에서 이미 새로고침했는지 확인
      const refreshKey = 'certificate_list_auto_refresh';
      const hasRefreshed = sessionStorage.getItem(refreshKey);
      
      if (!hasRefreshed) {
        sessionStorage.setItem(refreshKey, 'true');
        window.location.reload();
      }
    }
  }, [isAuthenticated, loading]);

  // 성적서 목록 불러오기 (실시간 업데이트)
  useEffect(() => {
    if (!isAuthenticated || !userProfile) return;

    setLoadingCertificates(true);
    setError('');
    
    const certificatesRef = collection(db, 'certificates');
    const q = query(certificatesRef);
    
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
        
        // 클라이언트 사이드 정렬 (인덱스 없이 사용)
        certificatesData.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        
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
  }, [isAuthenticated, userProfile]);

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
      const statusLabel = STATUS_LABELS[cert.status]?.toLowerCase() || cert.status || '';

      return (
        customerName.includes(query) ||
        orderNumber.includes(query) ||
        productName.includes(query) ||
        productCode.includes(query) ||
        userName.includes(query) ||
        statusLabel.includes(query) ||
        cert.status.includes(query)
      );
    });

    setFilteredCertificates(filtered);
    setCurrentPage(1); // 검색 시 첫 페이지로 리셋
  }, [searchQuery, certificates]);

  // 페이지네이션
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setDisplayedCertificates(filteredCertificates.slice(startIndex, endIndex));
  }, [filteredCertificates, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredCertificates.length / itemsPerPage);

  const handleEdit = (certificate: Certificate) => {
    router.push(`/certificate/request?id=${certificate.id}`);
  };

  const handleDelete = async (certificate: Certificate) => {
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">성적서 목록</h1>
              <p className="text-gray-600">요청한 성적서를 확인하고 관리할 수 있습니다</p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // 실시간 업데이트가 작동 중이지만, 사용자 요청에 따라 페이지 새로고침
                  window.location.reload();
                }}
                disabled={loadingCertificates}
              >
                새로고침
              </Button>
              <Link href="/certificate/request">
                <Button variant="primary" size="sm">
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
                placeholder="고객명, 발주번호, 제품명, 제품코드, 요청자, 상태 검색..."
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
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">번호</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px]">요청자</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">요청일</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px]">고객명</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">발주번호</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">제품명</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">제품코드</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">수량</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">완료요청일</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">완료예정일</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">완료일</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">첨부</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">비고</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">상태</th>
                        <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px]">관리</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {displayedCertificates.map((certificate, idx) => {
                        const absoluteIndex = (currentPage - 1) * itemsPerPage + idx;
                        const rowNumber = filteredCertificates.length - absoluteIndex;
                        return (
                          <tr key={certificate.id} className="hover:bg-gray-50">
                            <td className="px-1 py-2 text-xs text-gray-900 text-center w-12">
                              {rowNumber}
                            </td>
                            <td className="px-1 py-2 min-w-[80px]">
                              <div className="text-xs text-gray-900 truncate" title={certificate.userName || '-'}>{certificate.userName || '-'}</div>
                            </td>
                            <td className="px-1 py-2 w-20">
                              <div className="text-xs text-gray-900 whitespace-nowrap">{formatDateShort(certificate.requestDate)}</div>
                            </td>
                            <td className="px-1 py-2 min-w-[80px]">
                              <div className="text-xs text-gray-900 truncate" title={certificate.customerName || '-'}>{certificate.customerName || '-'}</div>
                            </td>
                            <td className="px-1 py-2 min-w-[100px]">
                              <div className="text-xs text-gray-900 truncate" title={certificate.orderNumber || '-'}>{certificate.orderNumber || '-'}</div>
                            </td>
                            <td className="px-1 py-2 min-w-[100px]">
                              <div className="text-xs font-medium text-gray-900 truncate" title={certificate.productName || '-'}>{certificate.productName || '-'}</div>
                            </td>
                            <td className="px-1 py-2 min-w-[100px]">
                              <div className="text-xs text-gray-900 truncate" title={certificate.productCode || '-'}>{certificate.productCode || '-'}</div>
                            </td>
                            <td className="px-1 py-2 w-16">
                              <div className="text-xs text-gray-900 text-center">{certificate.quantity ? certificate.quantity.toLocaleString() : '-'}</div>
                            </td>
                            <td className="px-1 py-2 w-20">
                              <div className="text-xs text-gray-900 whitespace-nowrap">{certificate.requestedCompletionDate ? formatDateShort(certificate.requestedCompletionDate) : '-'}</div>
                            </td>
                            <td className="px-1 py-2 w-20">
                              <div className="text-xs text-gray-900 whitespace-nowrap">
                                {certificate.status === 'in_progress' || certificate.status === 'completed'
                                  ? (certificate.requestedCompletionDate ? formatDateShort(certificate.requestedCompletionDate) : '-')
                                  : '-'}
                              </div>
                            </td>
                            <td className="px-1 py-2 w-20">
                              <div className="text-xs text-gray-900 whitespace-nowrap">{certificate.completedAt ? formatDateShort(certificate.completedAt) : '-'}</div>
                            </td>
                            <td className="px-1 py-2 w-16">
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
                            <td className="px-1 py-2 w-16">
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
                            <td className="px-1 py-2 w-16">
                              <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full ${STATUS_COLORS[certificate.status]}`}>
                                {STATUS_LABELS[certificate.status]}
                              </span>
                            </td>
                            <td className="px-1 py-2 min-w-[80px]">
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

