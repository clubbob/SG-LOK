"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { collection, query, getDocs, getDocsFromServer, Timestamp, onSnapshot, orderBy, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CertificateProduct, ProductionRequest, ProductionRequestStatus, ProductionSalesRegion } from '@/types';
import {
  buildProductionRequestLineApprovalPatch,
  buildProductionRequestRegistrationFields,
  expandProductionRequestsToListRows,
  prepareProductionRequestProgressPdfRows,
  PRODUCTION_REQUEST_CSV_HEADERS,
  buildProductionRequestListRowCsvValues,
  type ProductionRequestListRow,
} from '@/lib/production/productionRequestDisplay';
import { sanitizeForFirestore } from '@/lib/firestoreSanitize';
import { downloadProductionRequestListPdf } from '@/lib/production/productionRequestListPdf';
import { removeProductionRequestProductLine } from '@/lib/production/removeProductionRequestProductLine';
import {
  ADMIN_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER,
  EMPTY_PRODUCTION_REQUEST_PANEL_FILTERS,
  filterProductionListRows,
  normalizeProductionRequestPanelStatusFilter,
  type ProductionRequestPanelFilters,
} from '@/lib/production/productionRequestSearch';
import { Button, DateInput } from '@/components/ui';
import { ProductionRequestSearchPanel } from '@/components/production/ProductionRequestSearchPanel';
import { ProductionRequestRegistrationTable } from '@/components/production/ProductionRequestRegistrationTable';
import { ProductionRequestStatusSection } from '@/components/production/ProductionRequestStatusSection';

const ADMIN_SESSION_KEY = 'admin_session';

// 관리자 인증 확인 함수
const checkAdminAuth = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  const sessionData = localStorage.getItem(ADMIN_SESSION_KEY);
  if (!sessionData?.trim()) return false;
  
  try {
    const session = JSON.parse(sessionData);
    const now = new Date().getTime();
    
    if (now > session.expiresAt) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    
    return session.authenticated === true;
  } catch {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    return false;
  }
};

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

const getRequestDisplayStatusLabel = (request: ProductionRequest): string =>
  STATUS_LABELS[request.status];

const getListRowDisplayStatusLabel = (listRow: ProductionRequestListRow): string =>
  STATUS_LABELS[listRow.lineStatus];

const getListRowDisplayStatusColor = (listRow: ProductionRequestListRow): string =>
  STATUS_COLORS[listRow.lineStatus];

export default function AdminProductionPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 sm:p-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">로딩 중...</p>
            </div>
          </div>
        </div>
      }
    >
      <AdminProductionPageContent />
    </Suspense>
  );
}

function AdminProductionPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [requests, setRequests] = useState<ProductionRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [error, setError] = useState('');
  const [displayedListRows, setDisplayedListRows] = useState<ProductionRequestListRow[]>([]);
  const itemsPerPage = 10; // 명시적으로 10개로 설정
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingRowKey, setDeletingRowKey] = useState<string | null>(null);
  const [selectedMemo, setSelectedMemo] = useState<{ id: string; memo: string } | null>(null);
  const [selectedProductionIssue, setSelectedProductionIssue] = useState<string | null>(null);
  const [approvingListRow, setApprovingListRow] = useState<ProductionRequestListRow | null>(null);
  const [approvalForm, setApprovalForm] = useState({
    plannedQuantity: '',
    plannedCompletionDate: '',
  });
  const [approving, setApproving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const skipUrlStatusSyncRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<ProductionRequestPanelFilters>(() => ({
    ...EMPTY_PRODUCTION_REQUEST_PANEL_FILTERS,
    status: normalizeProductionRequestPanelStatusFilter(searchParams.get('status')),
  }));
  useEffect(() => {
    if (skipUrlStatusSyncRef.current) {
      if (!searchParams.get('status')) {
        skipUrlStatusSyncRef.current = false;
      }
      return;
    }
    const statusFromUrl = normalizeProductionRequestPanelStatusFilter(searchParams.get('status'));
    setFilters((prev) => (prev.status === statusFromUrl ? prev : { ...prev, status: statusFromUrl }));
  }, [searchParams]);

  useEffect(() => {
    const statusFromUrl = normalizeProductionRequestPanelStatusFilter(searchParams.get('status'));
    if (filters.status === statusFromUrl) return;

    const params = new URLSearchParams(searchParams.toString());
    if (filters.status) params.set('status', filters.status);
    else params.delete('status');
    const qs = params.toString();
    router.replace(qs ? `/admin/production?${qs}` : '/admin/production', { scroll: false });
  }, [filters.status, router, searchParams]);

  const handleFiltersChange = (patch: Partial<ProductionRequestPanelFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const filteredListRows = useMemo(
    () =>
      filterProductionListRows(requests, searchQuery, filters, getListRowDisplayStatusLabel),
    [requests, searchQuery, filters]
  );

  const allListRows = useMemo(() => expandProductionRequestsToListRows(requests), [requests]);
  const progressPdfRows = useMemo(
    () => prepareProductionRequestProgressPdfRows(allListRows),
    [allListRows]
  );

  const applyProductionRequestsSnapshot = useCallback(
    (querySnapshot: { forEach: (fn: (doc: { id: string; data: () => Record<string, unknown> }) => void) => void }) => {
      const requestsData: ProductionRequest[] = [];

      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const rawOrderQty = data.orderQuantity ?? data.orderqty ?? data.order_qty;
        const parsedOrderQty =
          typeof rawOrderQty === 'number'
            ? rawOrderQty
            : rawOrderQty
              ? Number(rawOrderQty)
              : undefined;

        const currentStatus = (data.status as ProductionRequestStatus) || 'pending_review';

        requestsData.push({
          id: docSnap.id,
          userId: (data.userId as string) ?? '',
          userName: (data.userName as string) ?? '',
          userEmail: (data.userEmail as string) ?? '',
          userCompany: data.userCompany as string | undefined,
          productName: (data.productName as string) ?? '',
          productCode: (data.productCode as string) || '',
          quantity: (data.quantity as number) ?? 0,
          orderQuantity: parsedOrderQty,
          plannedQuantity: data.plannedQuantity as number | undefined,
          requestDate:
            (data.requestDate as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(),
          requestedCompletionDate:
            (data.requestedCompletionDate as { toDate?: () => Date } | undefined)?.toDate?.() ||
            new Date(),
          productionReason: data.productionReason as ProductionRequest['productionReason'],
          salesRegion:
            data.salesRegion === 'overseas' || data.salesRegion === 'domestic'
              ? (data.salesRegion as ProductionSalesRegion)
              : undefined,
          products: Array.isArray(data.products)
            ? (data.products as CertificateProduct[])
            : undefined,
          customerName: data.customerName as string | undefined,
          status: currentStatus,
          itemCode: data.itemCode as string | undefined,
          itemName: data.itemName as string | undefined,
          plannedStartDate: (data.plannedStartDate as { toDate?: () => Date } | undefined)?.toDate?.(),
          plannedCompletionDate: (
            data.plannedCompletionDate as { toDate?: () => Date } | undefined
          )?.toDate?.(),
          actualStartDate: (data.actualStartDate as { toDate?: () => Date } | undefined)?.toDate?.(),
          actualCompletionDate: (
            data.actualCompletionDate as { toDate?: () => Date } | undefined
          )?.toDate?.(),
          actualCompletionQuantity: data.actualCompletionQuantity as number | undefined,
          priority: data.priority as ProductionRequest['priority'],
          memo: (data.memo as string) || '',
          adminMemo: (data.adminMemo as string) || '',
          productionIssue: (data.productionIssue as string) || undefined,
          createdAt: (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(),
          updatedAt: (data.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(),
          createdBy: (data.createdBy as string) ?? '',
          updatedBy: data.updatedBy as string | undefined,
          history: data.history as ProductionRequest['history'],
        });
      });

      requestsData.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      setRequests(requestsData);
      setLoadingRequests(false);
    },
    []
  );

  useEffect(() => {
    // 관리자 세션 확인
    if (!checkAdminAuth()) {
      router.push('/admin/login');
      return;
    }

    setLoadingRequests(true);
    setError('');

    const requestsRef = collection(db, 'productionRequests');
    const q = query(requestsRef, orderBy('createdAt', 'desc'));
    
    const unsubscribeSnapshot = onSnapshot(
      q,
      (querySnapshot) => {
        applyProductionRequestsSnapshot(querySnapshot);
      },
      (error) => {
        console.error('생산요청 목록 로드 오류:', error);
        const firebaseError = error as { code?: string; message?: string };
        setError(`생산요청 현황을 불러오는데 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
        setLoadingRequests(false);
      }
    );

    return () => unsubscribeSnapshot();
  }, [router, applyProductionRequestsSnapshot]);

  const handleRefresh = async () => {
    if (!checkAdminAuth()) return;
    setRefreshing(true);
    setError('');
    skipUrlStatusSyncRef.current = true;
    setSearchQuery('');
    setFilters({ ...EMPTY_PRODUCTION_REQUEST_PANEL_FILTERS });
    setCurrentPage(1);
    router.replace('/admin/production', { scroll: false });
    try {
      const q = query(collection(db, 'productionRequests'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocsFromServer(q);
      applyProductionRequestsSnapshot(snapshot);
    } catch (err) {
      console.error('생산요청 새로고침 오류:', err);
      const firebaseError = err as { code?: string; message?: string };
      setError(`목록을 새로고침하지 못했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setRefreshing(false);
    }
  };

  // 검색·필터 변경 시 페이지
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
  const totalListRowCount = useMemo(
    () => expandProductionRequestsToListRows(requests).length,
    [requests]
  );

  const handleEdit = (listRow: ProductionRequestListRow) => {
    router.push(
      `/admin/production/request?id=${listRow.request.id}&productIndex=${listRow.productIndex}`
    );
  };

  const emptyApprovalForm = {
    plannedQuantity: '',
    plannedCompletionDate: '',
  };

  const toDateInputValue = (date: Date | undefined): string => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayDateInputMin = toDateInputValue(new Date());

  const handleApprove = (listRow: ProductionRequestListRow) => {
    const request = listRow.request;
    setApprovingListRow(listRow);
    setApprovalForm({
      plannedQuantity: listRow.plannedQuantity?.toString() || '',
      plannedCompletionDate: toDateInputValue(listRow.plannedCompletionDate),
    });
  };

  const handleApproveSubmit = async () => {
    if (!approvingListRow) return;

    if (!approvalForm.plannedQuantity.trim()) {
      setError('생산계획수량을 입력해주세요.');
      return;
    }
    const plannedQuantityNum = parseInt(approvalForm.plannedQuantity, 10);
    if (isNaN(plannedQuantityNum) || plannedQuantityNum <= 0) {
      setError('생산계획수량은 1 이상의 숫자여야 합니다.');
      return;
    }
    if (!approvalForm.plannedCompletionDate.trim()) {
      setError('완료예정일을 입력해주세요.');
      return;
    }
    const plannedCompletion = new Date(approvalForm.plannedCompletionDate);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    plannedCompletion.setHours(0, 0, 0, 0);
    if (Number.isNaN(plannedCompletion.getTime()) || plannedCompletion < todayStart) {
      setError('완료예정일은 오늘 이후여야 합니다.');
      return;
    }

    setApproving(true);
    setError('');

    try {
      const updateData = buildProductionRequestLineApprovalPatch(approvingListRow, {
        plannedQuantity: plannedQuantityNum,
        plannedCompletionDate: new Date(approvalForm.plannedCompletionDate),
      });

      await updateDoc(
        doc(db, 'productionRequests', approvingListRow.request.id),
        sanitizeForFirestore(updateData)
      );

      // 모달 닫기
      setApprovingListRow(null);
      setApprovalForm(emptyApprovalForm);
      // 실시간 업데이트로 자동 새로고침됨
    } catch (error) {
      console.error('생산요청 승인 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`생산요청 승인에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setApproving(false);
    }
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

    const headers = PRODUCTION_REQUEST_CSV_HEADERS;

    // 엑셀은 최근 등록이 위쪽에 오도록 역순 출력, 번호는 목록과 동일(최신=가장 큰 번호)
    const exportRows = [...filteredListRows].reverse();
    const rows = exportRows.map((listRow, idx) => {
      const rowNumber = exportRows.length - idx;
      const statusLabel = getListRowDisplayStatusLabel(listRow);
      const cols = buildProductionRequestListRowCsvValues(listRow, rowNumber, statusLabel);
      return cols.map(escapeCSV).join(',');
    });

    const csvContent = [headers.map(escapeCSV).join(','), ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    link.download = `admin_production_requests_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportToPdf = async () => {
    if (progressPdfRows.length === 0) return;
    setGeneratingPdf(true);
    setError('');
    try {
      await downloadProductionRequestListPdf(allListRows, getListRowDisplayStatusLabel);
    } catch (err) {
      console.error('생산요청 PDF 생성 오류:', err);
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      setError(`PDF 파일 생성에 실패했습니다: ${message}`);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDeleteLine = async (listRow: ProductionRequestListRow) => {
    const request = listRow.request;
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

  if (loadingRequests && requests.length === 0) {
    return (
      <div className="p-4 sm:p-8">
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
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">생산요청 현황</h1>
          <p className="text-gray-600 mt-2 text-sm sm:text-base">전체 생산요청 현황을 확인하고 관리할 수 있습니다</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto sm:flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto justify-center gap-2 whitespace-nowrap"
            onClick={() => void handleRefresh()}
            disabled={refreshing || (loadingRequests && requests.length === 0)}
          >
            <svg
              className={`w-4 h-4 shrink-0 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            새로고침
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto justify-center gap-2 whitespace-nowrap"
            onClick={() => void handleExportToPdf()}
            disabled={refreshing || loadingRequests || generatingPdf || progressPdfRows.length === 0}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
            {generatingPdf ? 'PDF 생성 중…' : 'PDF 파일 생성'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto justify-center gap-2 whitespace-nowrap"
            onClick={handleExportToExcel}
            disabled={refreshing || loadingRequests || generatingPdf || filteredListRows.length === 0}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16v4H4m4 4h8m-8 4h5m-1 4l-3-3h6l-3 3z" />
            </svg>
            엑셀 다운로드
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

      <ProductionRequestSearchPanel
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        placeholder={ADMIN_PRODUCTION_REQUEST_SEARCH_PLACEHOLDER}
        filters={filters}
        onFiltersChange={handleFiltersChange}
      />

      {requests.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="text-sm font-normal text-gray-500 mb-2">등록된 생산요청이 없습니다</h3>
        </div>
      ) : filteredListRows.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <h3 className="text-sm font-normal text-gray-500 mb-2">선택한 조건에 맞는 생산요청이 없습니다</h3>
          <p className="text-xs text-gray-400">조건 초기화 후 다시 확인하거나 새로고침해 보세요.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {displayedListRows.map((listRow, idx) => {
              const request = listRow.request;
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
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getListRowDisplayStatusColor(listRow)}`}>
                      {getListRowDisplayStatusLabel(listRow)}
                    </span>
                  }
                  actions={
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      {listRow.lineStatus === 'pending_review' && (
                        <>
                          <button
                            onClick={() => handleApprove(listRow)}
                            className="text-green-600 hover:text-green-800 text-sm font-medium"
                            disabled={deletingRowKey === listRow.rowKey || approving}
                          >
                            승인
                          </button>
                          <span className="text-gray-300">|</span>
                        </>
                      )}
                      <button
                        onClick={() => handleEdit(listRow)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        disabled={deletingRowKey === listRow.rowKey || approving}
                      >
                        업데이트
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => handleDeleteLine(listRow)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                        disabled={deletingRowKey === listRow.rowKey || approving}
                      >
                        {deletingRowKey === listRow.rowKey ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  }
                  onOpenMemo={() =>
                    setSelectedMemo({
                      id: request.id,
                      memo: listRow.remark || request.memo || '',
                    })
                  }
                  onOpenProductionIssue={() =>
                    setSelectedProductionIssue(listRow.productionIssue?.trim() || '')
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

      {/* 승인 모달 */}
      {approvingListRow && (
        <div 
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black bg-opacity-30 p-4 sm:items-center sm:p-6" 
          onMouseDown={(e) => {
            // 모달 내부가 아닌 배경만 클릭했을 때만 모달 닫기
            if (e.target === e.currentTarget) {
              setApprovingListRow(null);
            }
          }}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-3xl w-full flex flex-col relative max-h-[calc(100vh-2rem)] sm:max-h-[min(90vh,40rem)] min-h-0 my-auto" 
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0 bg-white rounded-t-lg">
              <h3 className="text-lg font-semibold text-gray-900">생산요청 승인</h3>
              <button
                onClick={() => {
                  setApprovingListRow(null);
                  setApprovalForm(emptyApprovalForm);
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
              className="px-6 py-4 overflow-y-auto flex-1 min-h-0 overscroll-contain"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
              <div className="space-y-4">
                <ProductionRequestRegistrationTable
                  caption="제품 정보"
                  fields={buildProductionRequestRegistrationFields(approvingListRow)}
                />
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">승인 입력</p>
                <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <label htmlFor="plannedQuantity" className="block text-sm font-medium text-gray-700 mb-2">
                    생산계획수량 *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    id="plannedQuantity"
                    value={approvalForm.plannedQuantity}
                    onChange={(e) => {
                      e.stopPropagation();
                      const digitsOnly = e.target.value.replace(/[^\d]/g, '');
                      setApprovalForm({ ...approvalForm, plannedQuantity: digitsOnly });
                      if (error) setError('');
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="생산계획수량 입력"
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    disabled={approving}
                    pattern="[0-9]*"
                    autoComplete="off"
                    required
                  />
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <DateInput
                    id="plannedCompletionDate"
                    label="완료예정일 *"
                    value={approvalForm.plannedCompletionDate}
                    min={todayDateInputMin}
                    onChange={(e) => {
                      e.stopPropagation();
                      setApprovalForm({ ...approvalForm, plannedCompletionDate: e.target.value });
                      if (error) setError('');
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    disabled={approving}
                    required
                  />
                </div>
              </div>
            </div>
            <div 
              className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2 shrink-0 bg-white rounded-b-lg"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Button
                variant="outline"
                onClick={() => {
                  setApprovingListRow(null);
                  setApprovalForm(emptyApprovalForm);
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

      {selectedProductionIssue != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30"
          onClick={() => setSelectedProductionIssue(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-900">생산 이슈</h3>
              <button
                type="button"
                onClick={() => setSelectedProductionIssue(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1">
              {selectedProductionIssue ? (
                <div className="text-sm text-gray-900 whitespace-pre-wrap bg-amber-50/80 border border-amber-100 p-3 rounded-md">
                  {selectedProductionIssue}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">등록된 생산 이슈가 없습니다.</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end sticky bottom-0 bg-white">
              <Button variant="primary" onClick={() => setSelectedProductionIssue(null)}>
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
              <h3 className="text-lg font-semibold text-gray-900">비고</h3>
              <button
                onClick={() => setSelectedMemo(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
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
  );
}

