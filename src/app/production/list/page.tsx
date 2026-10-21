"use client";

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CertificateProduct, ProductionRequest, ProductionRequestStatus, ProductionSalesRegion } from '@/types';
import { ProductionRequestProductLines } from '@/components/production/ProductionRequestProductLines';
import {
  expandProductionRequestsToListRows,
  formatProductionReasonLabel,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';
import { removeProductionRequestProductLine } from '@/lib/production/removeProductionRequestProductLine';
import {
  PRODUCTION_REQUEST_SEARCH_HELP,
  USER_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER,
  productionRequestMatchesSearch,
} from '@/lib/production/productionRequestSearch';
import { formatDate, formatDateTime, formatDateShort } from '@/lib/utils';

const STATUS_LABELS: Record<ProductionRequestStatus, string> = {
  pending_review: '대기중',
  confirmed: '진행중',
  in_progress: '진행중',
  completed: '생산 완료',
  cancelled: '취소',
};

const STATUS_COLORS: Record<ProductionRequestStatus, string> = {
  pending_review: 'bg-yellow-400 text-white',
  confirmed: 'bg-green-500 text-white',
  in_progress: 'bg-green-500 text-white',
  completed: 'bg-gray-500 text-white',
  cancelled: 'bg-red-500 text-white',
};

const getDisplayStatusLabel = (request: ProductionRequest): string => {
  if (request.cleaningEpCompletionDate) return '세정/EP 완료';
  return STATUS_LABELS[request.status];
};

const getDisplayStatusColor = (request: ProductionRequest): string => {
  if (request.cleaningEpCompletionDate) return 'bg-teal-600 text-white';
  return STATUS_COLORS[request.status];
};

/** 날짜만 비교 (시분초 무시). a가 b보다 늦으면 true */
const isDateAfter = (a?: Date, b?: Date): boolean => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return da.getTime() > db.getTime();
};


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
  const [deletingRowKey, setDeletingRowKey] = useState<string | null>(null);
  const [selectedMemo, setSelectedMemo] = useState<{ id: string; memo: string; adminMemo?: string } | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ProductionRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredRequests, setFilteredRequests] = useState<ProductionRequest[]>([]);

  const filteredListRows = useMemo(
    () => expandProductionRequestsToListRows(filteredRequests),
    [filteredRequests]
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

  // 생산요청 목록: 로그인 사용자 본인이 등록한 요청만 조회
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
    const q = query(requestsRef, where('userId', '==', userProfile.id));
    
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
            cleaningEpCompletionDate: data.cleaningEpCompletionDate?.toDate(),
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

  // 상태(URL) + 검색 필터링 (관리자 생산 목록과 동일한 status 쿼리)
  useEffect(() => {
    const statusFilterParam = searchParams.get('status');
    const statusFiltered = statusFilterParam
      ? requests.filter((request) => {
          if (statusFilterParam === 'in_progress') {
            return request.status === 'confirmed' || request.status === 'in_progress';
          }
          return request.status === statusFilterParam;
        })
      : requests;

    if (!searchQuery.trim()) {
      setFilteredRequests(statusFiltered);
      if (statusFiltered.length > 0) {
        const ITEMS_PER_PAGE = 10;
        const expanded = expandProductionRequestsToListRows(statusFiltered);
        const totalPages = Math.ceil(expanded.length / ITEMS_PER_PAGE);
        setCurrentPage(totalPages > 0 ? totalPages : 1);
      } else {
        setCurrentPage(1);
      }
      return;
    }

    const filtered = statusFiltered.filter((request) =>
      productionRequestMatchesSearch(request, searchQuery, getDisplayStatusLabel)
    );

    setFilteredRequests(filtered);
    setCurrentPage(1);
  }, [searchQuery, requests, searchParams]);

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

  const handleEdit = (listRow: ProductionRequestListRow) => {
    router.push(
      `/production/request?id=${listRow.request.id}&productIndex=${listRow.productIndex}`
    );
  };

  const handleDeleteLine = async (listRow: ProductionRequestListRow) => {
    const request = listRow.request;
    if (userProfile?.id && request.userId !== userProfile.id) {
      return;
    }
    const multiProduct = (request.products?.length ?? 0) > 1;
    const confirmMessage = multiProduct
      ? `"${listRow.productName}" 제품만 삭제하시겠습니까? (다른 제품은 유지됩니다)`
      : `정말로 "${listRow.productName}" 생산요청을 삭제하시겠습니까?`;
    if (!confirm(confirmMessage)) {
      return;
    }

    setDeletingRowKey(listRow.rowKey);
    try {
      await removeProductionRequestProductLine(listRow);
    } catch (error) {
      console.error('생산요청 삭제 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`삭제에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setDeletingRowKey(null);
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
      '요청일',
      '제품명',
      '제품코드',
      '생산목적',
      '고객사명',
      '수주수량',
      '요청수량',
      '계획수량',
      '완료요청일',
      '완료예정일',
      '생산완료일',
      '세정/EP 완료일',
      '비고',
      '상태',
    ];

    // 엑셀은 최근 등록이 위쪽에 오도록 역순 출력, 번호는 목록과 동일(최신=가장 큰 번호)
    const exportRows = [...expandProductionRequestsToListRows(filteredRequests)].reverse();
    const rows = exportRows.map((listRow, idx) => {
      const request = listRow.request;
      const rowNumber = exportRows.length - idx;
      const productionReasonLabel = formatProductionReasonLabel(listRow.productionReason);
      const statusLabel = getDisplayStatusLabel(request);

      const requestedDateStr = listRow.requestedCompletionDate
        ? formatDateShort(listRow.requestedCompletionDate)
        : '';
      const plannedDateStr = request.plannedCompletionDate ? formatDateShort(request.plannedCompletionDate) : '';
      const actualDateStr = request.actualCompletionDate ? formatDateShort(request.actualCompletionDate) : '';
      const cleaningEpDateStr = request.cleaningEpCompletionDate
        ? formatDateShort(request.cleaningEpCompletionDate)
        : '';
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
        request.plannedQuantity ?? '',
        requestedDateStr,
        plannedDateStr,
        actualDateStr,
        cleaningEpDateStr,
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
        <div className="w-full max-w-[95%] mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-12">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">생산요청 현황</h1>
              <p className="text-gray-600 mt-2 text-sm sm:text-base">생산요청 현황을 확인할 수 있습니다</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto sm:flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto justify-center gap-2 whitespace-nowrap"
                onClick={() => {
                  // 실시간 업데이트가 작동 중이지만, 사용자 요청에 따라 버튼 제공
                  window.location.reload();
                }}
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
              <Link href="/production/request" className="w-full sm:w-auto">
                <Button size="sm" className="w-full sm:w-auto justify-center gap-2 whitespace-nowrap">
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                placeholder={USER_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER}
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
            <p className="mt-1.5 text-xs text-red-600 leading-relaxed">{PRODUCTION_REQUEST_SEARCH_HELP}</p>
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
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">요청일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">제품명</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">제품코드</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">생산목적</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">고객사명</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">수주수량</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">요청수량</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">계획수량</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">완료요청일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">완료예정일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">생산완료일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">세정/EP 완료일</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">비고</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">상태</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">관리</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {displayedListRows.map((listRow, idx) => {
                        const request = listRow.request;
                        const itemsPerPageValue = 10;
                        const reversedIdx = displayedListRows.length - 1 - idx;
                        const absoluteIndex = (currentPage - 1) * itemsPerPageValue + reversedIdx;
                        const rowNumber = absoluteIndex + 1;
                        const lineRequestedDate =
                          listRow.requestedCompletionDate ?? request.requestedCompletionDate;
                        return (
                        <tr key={listRow.rowKey} className="hover:bg-gray-50">
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
                            <div className="text-sm font-medium text-gray-900">{listRow.productName}</div>
                            {request.itemName && listRow.productIndex === 0 && (
                              <div className="text-xs text-gray-500">({request.itemName})</div>
                            )}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{listRow.productCode}</div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {formatProductionReasonLabel(listRow.productionReason)}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{listRow.customerName || '-'}</div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {listRow.orderQuantity != null
                                ? listRow.orderQuantity.toLocaleString()
                                : '-'}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {listRow.requestQuantity != null
                                ? listRow.requestQuantity.toLocaleString()
                                : '-'}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {request.plannedQuantity !== undefined && request.plannedQuantity !== null
                                ? request.plannedQuantity.toLocaleString()
                                : <span className="text-gray-400">-</span>}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {lineRequestedDate ? formatDateShort(lineRequestedDate) : '-'}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div
                              className={`text-sm ${
                                isDateAfter(request.plannedCompletionDate, lineRequestedDate)
                                  ? 'text-red-500'
                                  : 'text-gray-900'
                              }`}
                            >
                              {request.plannedCompletionDate ? (
                                formatDateShort(request.plannedCompletionDate)
                              ) : (
                                <span className="text-gray-400 font-normal">-</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div
                              className={`text-sm ${
                                isDateAfter(request.actualCompletionDate, request.plannedCompletionDate)
                                  ? 'text-red-500'
                                  : 'text-gray-900'
                              }`}
                            >
                              {request.actualCompletionDate ? (
                                formatDateShort(request.actualCompletionDate)
                              ) : (
                                <span className="text-gray-400 font-normal">-</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div
                              className={`text-sm ${
                                isDateAfter(request.cleaningEpCompletionDate, request.plannedCompletionDate)
                                  ? 'text-red-500'
                                  : 'text-gray-900'
                              }`}
                            >
                              {request.cleaningEpCompletionDate ? (
                                formatDateShort(request.cleaningEpCompletionDate)
                              ) : (
                                <span className="text-gray-400 font-normal">-</span>
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
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getDisplayStatusColor(request)}`}>
                              {getDisplayStatusLabel(request)}
                            </span>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {userProfile && request.userId === userProfile.id && request.status === 'pending_review' ? (
                                <>
                                  <button
                                    onClick={() => handleEdit(listRow)}
                                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                                    disabled={deletingRowKey === listRow.rowKey}
                                  >
                                    수정
                                  </button>
                                  <span className="text-gray-300">|</span>
                                  <button
                                    onClick={() => handleDeleteLine(listRow)}
                                    className="text-red-600 hover:text-red-800 text-sm font-medium"
                                    disabled={deletingRowKey === listRow.rowKey}
                                  >
                                    {deletingRowKey === listRow.rowKey ? '삭제 중...' : '삭제'}
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
                    <ProductionRequestProductLines request={selectedRequest} field="name" nameClassName="text-sm text-gray-900" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">제품코드</label>
                    <ProductionRequestProductLines request={selectedRequest} field="code" codeClassName="text-sm text-gray-900" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">생산목적</label>
                    <p className="text-sm text-gray-900">
                      {formatProductionReasonLabel(selectedRequest.productionReason)}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">고객사명</label>
                    <p className="text-sm text-gray-900">{selectedRequest.customerName || '-'}</p>
                  </div>
                  {selectedRequest.productionReason === 'order' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">수주수량</label>
                      <p className="text-sm text-gray-900">
                        {selectedRequest.orderQuantity
                          ? selectedRequest.orderQuantity.toLocaleString()
                          : '-'}
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">요청수량</label>
                    <p className="text-sm text-gray-900">{selectedRequest.quantity.toLocaleString()}</p>
                  </div>
                  {selectedRequest.plannedQuantity !== undefined && selectedRequest.plannedQuantity !== null && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">계획수량</label>
                      <p className="text-sm text-gray-900">{selectedRequest.plannedQuantity.toLocaleString()}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">요청일</label>
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
                  {selectedRequest.cleaningEpCompletionDate && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">세정/EP 완료일</label>
                      <p className="text-sm text-gray-900">{formatDateShort(selectedRequest.cleaningEpCompletionDate)}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getDisplayStatusColor(selectedRequest)}`}>
                      {getDisplayStatusLabel(selectedRequest)}
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
