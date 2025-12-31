"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';
import { collection, query, orderBy, getDocs, Timestamp, doc, deleteDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ProductionRequest, ProductionRequestStatus } from '@/types';
import { formatDate, formatDateTime, formatDateShort } from '@/lib/utils';

const STATUS_LABELS: Record<ProductionRequestStatus, string> = {
  pending_review: '검토 대기',
  confirmed: '계획 확정',
  in_progress: '생산 중',
  completed: '생산 완료',
  cancelled: '취소',
};

const STATUS_COLORS: Record<ProductionRequestStatus, string> = {
  pending_review: 'bg-yellow-400 text-white',
  confirmed: 'bg-blue-500 text-white',
  in_progress: 'bg-green-500 text-white',
  completed: 'bg-gray-500 text-white',
  cancelled: 'bg-red-500 text-white',
};


export default function ProductionRequestListPage() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const [requests, setRequests] = useState<ProductionRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [error, setError] = useState('');
  const [displayedRequests, setDisplayedRequests] = useState<ProductionRequest[]>([]);
  const [itemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedMemo, setSelectedMemo] = useState<{ id: string; memo: string; adminMemo?: string } | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ProductionRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredRequests, setFilteredRequests] = useState<ProductionRequest[]>([]);

  // 인증 확인
  useEffect(() => {
    // 로딩이 완료되고 인증되지 않은 경우에만 로그인 페이지로 리다이렉트
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  // 생산요청 목록 불러오기 (실시간 업데이트)
  useEffect(() => {
    if (!isAuthenticated || !userProfile) return;

    setLoadingRequests(true);
    setError('');
    
    const requestsRef = collection(db, 'productionRequests');
    const q = query(requestsRef, orderBy('createdAt', 'desc'));
    
    const unsubscribeSnapshot = onSnapshot(
      q,
      (querySnapshot) => {
        const requestsData: ProductionRequest[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          const rawOrderQty = data.orderQuantity ?? data.orderqty ?? data.order_qty;
          const parsedOrderQty =
            typeof rawOrderQty === 'number'
              ? rawOrderQty
              : rawOrderQty
              ? Number(rawOrderQty)
              : undefined;
          requestsData.push({
            id: doc.id,
            userId: data.userId,
            userName: data.userName,
            userEmail: data.userEmail,
            userCompany: data.userCompany,
            productName: data.productName,
            quantity: data.quantity,
            orderQuantity: parsedOrderQty,
            requestDate: data.requestDate?.toDate() || new Date(),
            requestedCompletionDate: data.requestedCompletionDate?.toDate() || new Date(),
            productionReason: data.productionReason,
            customerName: data.customerName,
            status: data.status || 'pending_review',
            itemCode: data.itemCode,
            itemName: data.itemName,
            plannedStartDate: data.plannedStartDate?.toDate(),
            plannedCompletionDate: data.plannedCompletionDate?.toDate(),
            actualStartDate: data.actualStartDate?.toDate(),
            actualCompletionDate: data.actualCompletionDate?.toDate(),
            priority: data.priority,
            memo: data.memo || '',
            adminMemo: data.adminMemo || '',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            createdBy: data.createdBy,
            updatedBy: data.updatedBy,
            history: data.history,
          });
        });
        
        // Firestore에서 이미 정렬되어 있지만, 안전을 위해 다시 정렬
        requestsData.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        
        setRequests(requestsData);
        setLoadingRequests(false);
      },
      (error) => {
        console.error('생산요청 목록 로드 오류:', error);
        const firebaseError = error as { code?: string; message?: string };
        setError(`생산요청 목록을 불러오는데 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
        setLoadingRequests(false);
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
      setFilteredRequests(requests);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = requests.filter((request) => {
      const productName = request.productName?.toLowerCase() || '';
      const productionReason = request.productionReason === 'order' ? '고객 주문' : '재고 준비';
      const customerName = request.customerName?.toLowerCase() || '';
      const userName = request.userName?.toLowerCase() || '';
      const statusLabel = STATUS_LABELS[request.status]?.toLowerCase() || request.status || '';
      return (
        productName.includes(query) ||
        productionReason.includes(query) ||
        customerName.includes(query) ||
        userName.includes(query) ||
        statusLabel.includes(query) ||
        request.status.includes(query)
      );
    });

    setFilteredRequests(filtered);
    setCurrentPage(1); // 검색 시 첫 페이지로 리셋
  }, [searchQuery, requests]);

  // 페이지네이션
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setDisplayedRequests(filteredRequests.slice(startIndex, endIndex));
  }, [filteredRequests, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredRequests.length / itemsPerPage);

  const handleEdit = (request: ProductionRequest) => {
    router.push(`/production/request?id=${request.id}`);
  };

  const handleDelete = async (request: ProductionRequest) => {
    if (!confirm(`정말로 "${request.productName}" 생산요청을 삭제하시겠습니까?`)) {
      return;
    }

    setDeletingId(request.id);
    try {
      await deleteDoc(doc(db, 'productionRequests', request.id));
      // 실시간 업데이트로 자동 새로고침됨
    } catch (error) {
      console.error('생산요청 삭제 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`생산요청 삭제에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setDeletingId(null);
    }
  };

  // 엑셀(CSV) 다운로드
  const handleExportToExcel = () => {
    if (filteredRequests.length === 0) {
      return;
    }

    const escapeCSV = (value: string | number | null | undefined) => {
      if (value === null || value === undefined) return '';
      const str = String(value).replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      '번호',
      '요청자',
      '등록일',
      '제품명',
      '생산목적',
      '고객사명',
      '수주수량',
      '생산수량',
      '완료요청일',
      '완료예정일',
      '생산완료일',
      '비고',
      '상태',
    ];

    const rows = filteredRequests.map((request, idx) => {
      const rowNumber = filteredRequests.length - idx;
      const productionReasonLabel = request.productionReason === 'order' ? '고객 주문' : '재고 준비';
      const statusLabel = STATUS_LABELS[request.status];

      const requestedDateStr = request.requestedCompletionDate ? formatDateShort(request.requestedCompletionDate) : '';
      const plannedDateStr = request.plannedCompletionDate ? formatDateShort(request.plannedCompletionDate) : '';
      const actualDateStr = request.actualCompletionDate ? formatDateShort(request.actualCompletionDate) : '';
      const requestDateStr = request.requestDate ? formatDateShort(request.requestDate) : '';

      const cols = [
        rowNumber,
        request.userName || '',
        requestDateStr,
        request.productName,
        productionReasonLabel,
        request.customerName || '',
        request.orderQuantity ?? '',
        request.quantity,
        requestedDateStr,
        plannedDateStr,
        actualDateStr,
        request.memo || '',
        statusLabel,
      ];

      return cols.map(escapeCSV).join(',');
    });

    const csvContent = [headers.map(escapeCSV).join(','), ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    link.download = `production_requests_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading || loadingRequests) {
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
        <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">생산요청 목록</h1>
              <p className="text-gray-600 mt-2">모든 생산요청을 확인할 수 있습니다</p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // 실시간 업데이트가 작동 중이지만, 사용자 요청에 따라 버튼 제공
                  window.location.reload();
                }}
                disabled={loadingRequests}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                새로고침
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportToExcel}
                disabled={loadingRequests || filteredRequests.length === 0}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16v4H4m4 4h8m-8 4h5m-1 4l-3-3h6l-3 3z" />
                </svg>
                엑셀 다운로드
              </Button>
              <Link href="/production/request">
                <Button size="sm">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  새 생산요청 등록
                </Button>
              </Link>
            </div>
          </div>
          
          {/* 검색 입력 필드 */}
          <div className="mb-6">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="제품명, 생산목적, 고객사명, 상태 검색..."
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

          {requests.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center">
              <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">등록된 생산요청이 없습니다</h3>
              <p className="text-gray-600 mb-6">새 생산요청을 등록해보세요</p>
              <Link href="/production/request">
                <Button>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  생산요청 등록하기
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-12">번호</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">요청자</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">등록일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">제품명</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">생산목적</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">고객사명</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">수주수량</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">생산수량</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">완료요청일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">완료예정일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">생산완료일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">비고</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">상태</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">관리</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {displayedRequests.map((request, idx) => {
                        const absoluteIndex = (currentPage - 1) * itemsPerPage + idx;
                        const rowNumber = filteredRequests.length - absoluteIndex;
                        return (
                        <tr key={request.id} className="hover:bg-gray-50">
                          <td className="px-3 py-4 text-sm text-gray-900 whitespace-nowrap text-center w-12">
                            {rowNumber}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{request.userName || '-'}</div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{formatDateShort(request.requestDate)}</div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{request.productName}</div>
                            {request.itemName && <div className="text-xs text-gray-500">({request.itemName})</div>}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {request.productionReason === 'order' ? '고객 주문' : '재고 준비'}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{request.customerName || '-'}</div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {request.orderQuantity !== undefined && request.orderQuantity !== null
                                ? request.orderQuantity.toLocaleString()
                                : request.productionReason === 'order'
                                ? request.quantity.toLocaleString()
                                : '-'}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{request.quantity.toLocaleString()}</div>
                          </td>
                          <td className="px-3 py-4">
                            <div className="text-sm text-gray-900">
                              {(() => {
                                const requestDate = new Date(request.requestDate);
                                const completionDate = new Date(request.requestedCompletionDate);
                                const diffTime = completionDate.getTime() - requestDate.getTime();
                                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                return (
                                  <>
                                    <div>{formatDateShort(request.requestedCompletionDate)}</div>
                                    <div className="text-xs text-gray-500">(+{diffDays})</div>
                                  </>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="px-3 py-4">
                            <div className="text-sm text-gray-900">
                              {request.plannedCompletionDate
                                ? (() => {
                                    const requestDate = new Date(request.requestDate);
                                    const plannedDate = new Date(request.plannedCompletionDate);
                                    const diffTime = plannedDate.getTime() - requestDate.getTime();
                                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                    return (
                                      <>
                                        <div>{formatDateShort(request.plannedCompletionDate)}</div>
                                        <div className="text-xs text-gray-500">(+{diffDays})</div>
                                      </>
                                    );
                                  })()
                                : <span className="text-gray-400">-</span>
                              }
                            </div>
                          </td>
                          <td className="px-3 py-4">
                            <div className="text-sm text-gray-900">
                              {request.actualCompletionDate ? (
                                (() => {
                                  const requestDate = new Date(request.requestDate);
                                  const actualDate = new Date(request.actualCompletionDate);
                                  const diffTime = actualDate.getTime() - requestDate.getTime();
                                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                  return (
                                    <>
                                      <div>{formatDateShort(request.actualCompletionDate)}</div>
                                      <div className="text-xs text-gray-500">(+{diffDays})</div>
                                    </>
                                  );
                                })()
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              <button
                                onClick={() => setSelectedMemo({ 
                                  id: request.id, 
                                  memo: request.memo || '', 
                                  adminMemo: request.adminMemo 
                                })}
                                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                              >
                                보기
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[request.status]}`}>
                              {STATUS_LABELS[request.status]}
                            </span>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {userProfile && request.userId === userProfile.id && request.status === 'pending_review' ? (
                                <>
                                  <button
                                    onClick={() => handleEdit(request)}
                                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                                    disabled={deletingId === request.id}
                                  >
                                    수정
                                  </button>
                                  <span className="text-gray-300">|</span>
                                  <button
                                    onClick={() => handleDelete(request)}
                                    className="text-red-600 hover:text-red-800 text-sm font-medium"
                                    disabled={deletingId === request.id}
                                  >
                                    {deletingId === request.id ? '삭제 중...' : '삭제'}
                                  </button>
                                </>
                              ) : (
                                <span className="text-gray-400">-</span>
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
                        검색 결과 <span className="font-medium">{filteredRequests.length}</span>건 중{' '}
                        <span className="font-medium">
                          {(currentPage - 1) * itemsPerPage + 1}
                        </span>
                        -
                        <span className="font-medium">
                          {Math.min(currentPage * itemsPerPage, filteredRequests.length)}
                        </span>
                        건 표시 (전체 {requests.length}건)
                      </>
                    ) : (
                      <>
                        전체 <span className="font-medium">{filteredRequests.length}</span>건 중{' '}
                        <span className="font-medium">
                          {(currentPage - 1) * itemsPerPage + 1}
                        </span>
                        -
                        <span className="font-medium">
                          {Math.min(currentPage * itemsPerPage, filteredRequests.length)}
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
        </div>
      </main>
      <Footer />

      {/* 생산요청 상세 모달 */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setSelectedRequest(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-900">생산요청 상세</h3>
              <button
                onClick={() => setSelectedRequest(null)}
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">제품명</label>
                    <p className="text-sm text-gray-900">{selectedRequest.productName}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">생산목적</label>
                    <p className="text-sm text-gray-900">{selectedRequest.productionReason === 'order' ? '고객 주문' : '재고 준비'}</p>
                  </div>
                  {selectedRequest.productionReason === 'order' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">고객사명</label>
                        <p className="text-sm text-gray-900">{selectedRequest.customerName || '-'}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">수주수량</label>
                        <p className="text-sm text-gray-900">{selectedRequest.orderQuantity ? selectedRequest.orderQuantity.toLocaleString() : '-'}</p>
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">생산수량</label>
                    <p className="text-sm text-gray-900">{selectedRequest.quantity.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">등록일</label>
                    <p className="text-sm text-gray-900">{formatDateShort(selectedRequest.requestDate)}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">완료요청일</label>
                    <p className="text-sm text-gray-900">{formatDateShort(selectedRequest.requestedCompletionDate)}</p>
                  </div>
                  {selectedRequest.plannedCompletionDate && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">완료예정일</label>
                      <p className="text-sm text-gray-900">{formatDateShort(selectedRequest.plannedCompletionDate)}</p>
                    </div>
                  )}
                  {selectedRequest.actualCompletionDate && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">생산완료일</label>
                      <p className="text-sm text-gray-900">{formatDateShort(selectedRequest.actualCompletionDate)}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[selectedRequest.status]}`}>
                      {STATUS_LABELS[selectedRequest.status]}
                    </span>
                  </div>
                </div>
                {selectedRequest.memo && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">비고</label>
                    <p className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded-md">{selectedRequest.memo}</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">관리자 비고</label>
                  {selectedRequest.adminMemo ? (
                    <p className="text-sm text-gray-900 whitespace-pre-wrap bg-blue-50 p-3 rounded-md border border-blue-200">{selectedRequest.adminMemo}</p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">관리자 비고가 없습니다.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end sticky bottom-0 bg-white">
              <Button
                variant="primary"
                onClick={() => setSelectedRequest(null)}
              >
                닫기
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 비고 상세 모달 */}
      {selectedMemo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setSelectedMemo(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">비고</h3>
              <button
                onClick={() => setSelectedMemo(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">비고</label>
                {selectedMemo.memo ? (
                  <div className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded-md">
                    {selectedMemo.memo}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">비고가 없습니다.</p>
                )}
              </div>
              {selectedMemo.adminMemo && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">관리자 비고</label>
                  <div className="text-sm text-gray-900 whitespace-pre-wrap bg-blue-50 p-3 rounded-md border border-blue-200">
                    {selectedMemo.adminMemo}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
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
  );
}

