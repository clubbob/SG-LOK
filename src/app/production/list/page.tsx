"use client";

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CertificateProduct, ProductionRequest, ProductionRequestStatus, ProductionSalesRegion } from '@/types';
import { ProductionRequestStatusSection } from '@/components/production/ProductionRequestStatusSection';
import {
  expandProductionRequestsToListRows,
  formatProductionCompletionRoundDisplay,
  formatProductionReasonLabel,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';
import {
  EMPTY_PRODUCTION_REQUEST_PANEL_FILTERS,
  USER_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER,
  filterProductionListRows,
  type ProductionRequestPanelFilters,
} from '@/lib/production/productionRequestSearch';
import { ProductionRequestSearchPanel } from '@/components/production/ProductionRequestSearchPanel';
import { formatDate, formatDateTime, formatDateShort } from '@/lib/utils';

const STATUS_LABELS: Record<ProductionRequestStatus, string> = {
  pending_review: '승인 대기중',
  confirmed: '진행중',
  in_progress: '진행중',
  completed: '생산완료',
  cancelled: '취소',
};

const STATUS_COLORS: Record<ProductionRequestStatus, string> = {
  pending_review: 'bg-yellow-400 text-white',
  confirmed: 'bg-green-500 text-white',
  in_progress: 'bg-green-500 text-white',
  completed: 'bg-gray-500 text-white',
  cancelled: 'bg-red-500 text-white',
};

const getListRowDisplayStatusLabel = (listRow: ProductionRequestListRow): string =>
  STATUS_LABELS[listRow.lineStatus];

const getListRowDisplayStatusColor = (listRow: ProductionRequestListRow): string =>
  STATUS_COLORS[listRow.lineStatus];

function ProductionRequestListPageContent() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [requests, setRequests] = useState<ProductionRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [error, setError] = useState('');
  const [displayedListRows, setDisplayedListRows] = useState<ProductionRequestListRow[]>([]);
  const itemsPerPage = 10; // 명시적으로 10개로 설정
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedMemo, setSelectedMemo] = useState<{ id: string; memo: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<ProductionRequestPanelFilters>(() => ({
    ...EMPTY_PRODUCTION_REQUEST_PANEL_FILTERS,
    status: searchParams.get('status') || '',
  }));
  useEffect(() => {
    const statusFromUrl = searchParams.get('status') || '';
    setFilters((prev) => (prev.status === statusFromUrl ? prev : { ...prev, status: statusFromUrl }));
  }, [searchParams]);

  useEffect(() => {
    const statusFromUrl = searchParams.get('status') || '';
    if (filters.status === statusFromUrl) return;

    const params = new URLSearchParams(searchParams.toString());
    if (filters.status) params.set('status', filters.status);
    else params.delete('status');
    const qs = params.toString();
    router.replace(qs ? `/production/list?${qs}` : '/production/list', { scroll: false });
  }, [filters.status, router, searchParams]);

  const handleFiltersChange = (patch: Partial<ProductionRequestPanelFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const filteredListRows = useMemo(
    () => filterProductionListRows(requests, searchQuery, filters, getListRowDisplayStatusLabel),
    [requests, searchQuery, filters]
  );

  const totalListRowCount = useMemo(
    () => expandProductionRequestsToListRows(requests).length,
    [requests]
  );

  // 인증 확인
  useEffect(() => {
    // 로딩이 완료되고 인증되지 않은 경우에만 로그인 페이지로 리다이렉트
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  // 생산요청 목록: 로그인 사용자 — 전체 생산요청 조회 (조회 전용)
  useEffect(() => {
    if (!isAuthenticated) {
      setLoadingRequests(false);
      setRequests([]);
      return;
    }
    if (!userProfile?.id) {
      setLoadingRequests(true);
      return;
    }

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
            productCode: data.productCode || '',
            quantity: data.quantity,
            orderQuantity: parsedOrderQty,
            requestDate: data.requestDate?.toDate() || new Date(),
            requestedCompletionDate: data.requestedCompletionDate?.toDate() || new Date(),
            productionReason: data.productionReason,
            salesRegion:
              data.salesRegion === 'overseas' || data.salesRegion === 'domestic'
                ? (data.salesRegion as ProductionSalesRegion)
                : undefined,
            products: Array.isArray(data.products)
              ? (data.products as CertificateProduct[])
              : undefined,
            customerName: data.customerName,
            status: data.status || 'pending_review',
            itemCode: data.itemCode,
            itemName: data.itemName,
            plannedStartDate: data.plannedStartDate?.toDate(),
            plannedCompletionDate: data.plannedCompletionDate?.toDate(),
            actualStartDate: data.actualStartDate?.toDate(),
            actualCompletionDate: data.actualCompletionDate?.toDate(),
            actualCompletionQuantity: data.actualCompletionQuantity,
            plannedQuantity: data.plannedQuantity,
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
        
        // 클라이언트 사이드 정렬 (오래된 순으로 정렬)
        requestsData.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        
        setRequests(requestsData);
        setLoadingRequests(false);
      },
      (error) => {
        console.error('생산요청 목록 로드 오류:', error);
        const firebaseError = error as { code?: string; message?: string };
        setError(`생산요청 현황을 불러오는데 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
        setLoadingRequests(false);
      }
    );

    // 컴포넌트 언마운트 시 구독 해제
    return () => {
      unsubscribeSnapshot();
    };
  }, [isAuthenticated, userProfile?.id]);

  useEffect(() => {
    const hasFilter =
      Boolean(searchQuery.trim()) ||
      Boolean(filters.productionReason) ||
      Boolean(filters.salesRegion) ||
      Boolean(filters.status);

    if (!hasFilter) {
      if (filteredListRows.length > 0) {
        const totalPages = Math.ceil(filteredListRows.length / itemsPerPage);
        setCurrentPage(totalPages > 0 ? totalPages : 1);
      } else {
        setCurrentPage(1);
      }
      return;
    }

    setCurrentPage(1);
  }, [searchQuery, filters, requests, filteredListRows.length, itemsPerPage]);

  // 페이지네이션 (제품 1개 = 1행)
  useEffect(() => {
    const ITEMS_PER_PAGE = 10;
    if (filteredListRows.length === 0) {
      setDisplayedListRows([]);
      return;
    }
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const sliced = filteredListRows.slice(startIndex, endIndex);
    const reversed = [...sliced].reverse();
    setDisplayedListRows(reversed);
  }, [filteredListRows, currentPage]);

  const totalPages = Math.ceil(filteredListRows.length / itemsPerPage);

  const handleRefresh = () => {
    setLoadingRequests(true);
    setError('');
    window.location.reload();
  };

  // 엑셀(CSV) 다운로드
  const handleExportToExcel = () => {
    if (filteredListRows.length === 0) {
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
      '요청일',
      '제품명',
      '제품코드',
      '생산목적',
      '고객사명',
      '수주수량',
      '요청수량',
      '완료요청일',
      '비고',
      '생산계획수량',
      '완료예정일',
      '1차 완료일 (수량)',
      '2차 완료일 (수량)',
      '3차 완료일 (수량)',
      '생산완료일 (수량)',
      '상태',
    ];

    // 엑셀은 최근 등록이 위쪽에 오도록 역순 출력, 번호는 목록과 동일(최신=가장 큰 번호)
    const exportRows = [...filteredListRows].reverse();
    const rows = exportRows.map((listRow, idx) => {
      const request = listRow.request;
      const rowNumber = exportRows.length - idx;
      const productionReasonLabel = formatProductionReasonLabel(listRow.productionReason);
      const statusLabel = getListRowDisplayStatusLabel(listRow);

      const requestedDateStr = listRow.requestedCompletionDate
        ? formatDateShort(listRow.requestedCompletionDate)
        : '';
      const plannedDateStr = listRow.plannedCompletionDate
        ? formatDateShort(listRow.plannedCompletionDate)
        : '';
      const actualDateStr = formatProductionCompletionRoundDisplay(listRow.actualCompletion);
      const actualDateStrForCsv = actualDateStr === '-' ? '' : actualDateStr;
      const requestDateStr = request.requestDate ? formatDateShort(request.requestDate) : '';

      const cols = [
        rowNumber,
        request.userName || '',
        requestDateStr,
        listRow.productName,
        listRow.productCode,
        productionReasonLabel,
        listRow.customerName || '',
        listRow.orderQuantity ?? '',
        listRow.requestQuantity ?? '',
        requestedDateStr,
        listRow.remark || '',
        listRow.plannedQuantity ?? '',
        plannedDateStr,
        formatProductionCompletionRoundDisplay(listRow.completionRounds[0] ?? {}),
        formatProductionCompletionRoundDisplay(listRow.completionRounds[1] ?? {}),
        formatProductionCompletionRoundDisplay(listRow.completionRounds[2] ?? {}),
        actualDateStrForCsv,
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
        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 py-6 sm:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">생산요청 현황</h1>
              <p className="text-gray-600 mt-2 text-sm sm:text-base">
                전체 생산요청 현황을 확인할 수 있습니다 (조회 전용)
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto sm:flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto justify-center gap-2 whitespace-nowrap"
                onClick={handleRefresh}
                disabled={loadingRequests}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                새로고침
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto justify-center gap-2 whitespace-nowrap"
                onClick={handleExportToExcel}
                disabled={loadingRequests || filteredListRows.length === 0}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16v4H4m4 4h8m-8 4h5m-1 4l-3-3h6l-3 3z" />
                </svg>
                엑셀 다운로드
              </Button>
            </div>
          </div>
          
          <ProductionRequestSearchPanel
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            placeholder={USER_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER}
            filters={filters}
            onFiltersChange={handleFiltersChange}
          />

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
              <h3 className="text-sm font-normal text-gray-500 mb-2">등록된 생산요청이 없습니다</h3>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {displayedListRows.map((listRow, idx) => {
                  const itemsPerPageValue = 10;
                  const reversedIdx = displayedListRows.length - 1 - idx;
                  const absoluteIndex = (currentPage - 1) * itemsPerPageValue + reversedIdx;
                  const rowNumber = absoluteIndex + 1;
                  return (
                    <ProductionRequestStatusSection
                      key={listRow.rowKey}
                      listRow={listRow}
                      rowNumber={rowNumber}
                      statusBadge={
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getListRowDisplayStatusColor(listRow)}`}
                        >
                          {getListRowDisplayStatusLabel(listRow)}
                        </span>
                      }
                      onOpenMemo={() =>
                        setSelectedMemo({
                          id: listRow.request.id,
                          memo: listRow.remark || listRow.request.memo || '',
                        })
                      }
                    />
                  );
                })}
              </div>

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-gray-700">
                    {searchQuery ? (
                      <>
                        검색 결과 <span className="font-medium">{filteredListRows.length}</span>건 중{' '}
                        <span className="font-medium">
                          {(currentPage - 1) * itemsPerPage + 1}
                        </span>
                        -
                        <span className="font-medium">
                          {Math.min(currentPage * itemsPerPage, filteredListRows.length)}
                        </span>
                        건 표시 (전체 {totalListRowCount}건)
                      </>
                    ) : (
                      <>
                        전체 <span className="font-medium">{filteredListRows.length}</span>건 중{' '}
                        <span className="font-medium">
                          {(currentPage - 1) * itemsPerPage + 1}
                        </span>
                        -
                        <span className="font-medium">
                          {Math.min(currentPage * itemsPerPage, filteredListRows.length)}
                        </span>
                        건 표시
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2 flex-wrap sm:flex-nowrap">
                    <Button
                      variant="outline"
                      size="sm"
                      className="whitespace-nowrap shrink-0 min-w-[3.75rem] px-2 sm:px-3"
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
                          className={`px-2.5 sm:px-3 py-1 text-sm rounded whitespace-nowrap shrink-0 ${
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
                      className="whitespace-nowrap shrink-0 min-w-[3.75rem] px-2 sm:px-3"
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

export default function ProductionRequestListPage() {
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
      <ProductionRequestListPageContent />
    </Suspense>
  );
}
