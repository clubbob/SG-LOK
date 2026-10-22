"use client";

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, DateInput, FormPageAlert, Input } from '@/components/ui';
import { collection, addDoc, Timestamp, getDocs, query, limit, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeForFirestore } from '@/lib/firestoreSanitize';
import {
  firestoreValueToDateInputString,
  isProductionRequestContentEditable,
  normalizeProductionRequestStatus,
} from '@/lib/production/productionRequestDisplay';
import {
  buildProductionRequestNotification,
  postAdminNotification,
} from '@/lib/adminNotifications';
import { RequestProductLinesSection } from '@/components/products/RequestProductLinesSection';
import {
  buildCertificateProductsFromLines,
  createEmptyRequestProductLine,
  linesFromFirestoreProducts,
  summarizeOrderQuantityFromOrderLines,
  summarizeProductionLegacyFromProducts,
  summarizeProductionRequestRootFromProducts,
  summarizeMemoFromProducts,
  summarizeRequestedCompletionDateFromProducts,
  validateRequestProductLines,
  type RequestProductLine,
} from '@/lib/products/requestProductLines';

const ADMIN_SESSION_KEY = 'admin_session';

const INITIAL_FORM_DATA = {
  plannedQuantity: '',
  plannedCompletionDate: '',
  actualCompletionDate: '',
  cleaningEpCompletionDate: '',
  adminMemo: '',
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

function AdminProductionRequestContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get('id');
  const productIndexParam = searchParams.get('productIndex');
  const [isEditMode, setIsEditMode] = useState(false);
  const [editProductIndex, setEditProductIndex] = useState<number | null>(null);
  const allProductLinesRef = useRef<RequestProductLine[] | null>(null);
  const [loadingRequest, setLoadingRequest] = useState(() => Boolean(requestId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [products, setProducts] = useState<RequestProductLine[]>([createEmptyRequestProductLine()]);
  const [currentStatus, setCurrentStatus] = useState<string>('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [customerNameSuggestions, setCustomerNameSuggestions] = useState<string[]>([]);

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setFieldError = (key: string, message: string) => {
    setFieldErrors((prev) => ({ ...prev, [key]: message }));
  };

  // 관리자 인증 확인
  useEffect(() => {
    if (!checkAdminAuth()) {
      router.push('/admin/login');
    }
  }, [router]);

  // 수정 모드: 기존 데이터 불러오기
  useEffect(() => {
    const loadRequestData = async () => {
      if (!requestId) return;

      setLoadingRequest(true);
      try {
        const requestDoc = await getDoc(doc(db, 'productionRequests', requestId));
        if (requestDoc.exists()) {
          const data = requestDoc.data();
          
          const status = normalizeProductionRequestStatus(data.status);
          const allLines = linesFromFirestoreProducts(data);
          allProductLinesRef.current = allLines;
          const parsedIndex =
            productIndexParam != null && productIndexParam !== ''
              ? Number.parseInt(productIndexParam, 10)
              : NaN;
          const singleLineIndex =
            !Number.isNaN(parsedIndex) && parsedIndex >= 0 && parsedIndex < allLines.length
              ? parsedIndex
              : null;

          setIsEditMode(true);
          setCurrentStatus(status);
          setEditProductIndex(singleLineIndex);
          setProducts(singleLineIndex != null ? [allLines[singleLineIndex]] : allLines);
          setFormData({
            plannedQuantity: data.plannedQuantity?.toString() || '',
            plannedCompletionDate: firestoreValueToDateInputString(data.plannedCompletionDate),
            actualCompletionDate: firestoreValueToDateInputString(data.actualCompletionDate),
            cleaningEpCompletionDate: firestoreValueToDateInputString(data.cleaningEpCompletionDate),
            adminMemo: data.adminMemo || '',
          });
        } else {
          setError('생산요청을 찾을 수 없습니다.');
          router.push('/admin/production');
        }
      } catch (error) {
        console.error('생산요청 로드 오류:', error);
        setError('생산요청을 불러오는데 실패했습니다.');
      } finally {
        setLoadingRequest(false);
      }
    };

    if (requestId) {
      loadRequestData();
    }
  }, [requestId, productIndexParam, router]);

  // 이전에 등록된 제품명 및 고객사명 목록 불러오기
  useEffect(() => {
    const loadSuggestions = async () => {
      try {
        const productionRequestsRef = collection(db, 'productionRequests');
        const q = query(productionRequestsRef, limit(500)); // 인덱스 없이 사용, 최대 500개
        const querySnapshot = await getDocs(q);
        
        const customerNames = new Set<string>();
        
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.customerName && typeof data.customerName === 'string') {
            customerNames.add(data.customerName);
          }
          if (Array.isArray(data.products)) {
            for (const p of data.products) {
              if (p?.customerName && typeof p.customerName === 'string') {
                customerNames.add(p.customerName);
              }
            }
          }
        });
        
        setCustomerNameSuggestions(Array.from(customerNames).sort());
      } catch (error) {
        console.error('고객사명 목록 로드 오류:', error);
      }
    };

    loadSuggestions();
  }, []);

  if (loadingRequest) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  const canEditRequestContent =
    !isEditMode || isProductionRequestContentEditable(currentStatus);
  /** 확정 이후 수정: 계획수량·완료일·관리자 비고 등 (대기중 수정은 등록 화면과 동일) */
  const showAdminPostReviewFields = isEditMode && !canEditRequestContent;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
    
    if (fieldErrors[name]) {
      setFieldErrors({
        ...fieldErrors,
        [name]: ''
      });
    }
    if (error) setError('');
    if (success) setSuccess('');
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (canEditRequestContent) {
      Object.assign(
        errors,
        validateRequestProductLines(products, {
          requireProductGroup: true,
          requireProductionContext: true,
          requireRequestedCompletionDate: true,
          allowPastRequestedCompletionDate: isEditMode,
        })
      );
    }

    // 계획수량 — 확정 이후 수정 시 필수
    if (
      isEditMode &&
      (currentStatus === 'confirmed' || currentStatus === 'completed' || currentStatus === 'in_progress')
    ) {
      if (!formData.plannedQuantity.trim()) {
        errors.plannedQuantity = '생산계획수량을 입력해주세요.';
      } else {
        const plannedQtyNum = parseInt(formData.plannedQuantity, 10);
        if (isNaN(plannedQtyNum) || plannedQtyNum <= 0) {
          errors.plannedQuantity = '생산계획수량은 1 이상의 숫자여야 합니다.';
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);

    if (!validateForm()) {
      setSubmitting(false);
      return;
    }

    try {
      const linesForSave =
        editProductIndex != null && allProductLinesRef.current
          ? (() => {
              const merged = [...allProductLinesRef.current];
              merged[editProductIndex] = products[0];
              return merged;
            })()
          : products;
      const productsData = buildCertificateProductsFromLines(linesForSave);
      const legacy = summarizeProductionLegacyFromProducts(productsData);

      if (canEditRequestContent && productsData.length === 0) {
        setError('제품 정보를 입력해주세요.');
        setSubmitting(false);
        return;
      }

      const rootMeta = summarizeProductionRequestRootFromProducts(productsData);
      const hasOrderLine = productsData.some((p) => p.productionReason === 'order');
      const totalOrderQuantity = summarizeOrderQuantityFromOrderLines(productsData);
      const rootRequestedCompletionDate = summarizeRequestedCompletionDateFromProducts(productsData);
      const { productionReason, salesRegion, customerName: rootCustomerName } = rootMeta;

      if (isEditMode && requestId) {
        // 수정 모드
        const productionRequestData: Record<string, unknown> = {
          updatedAt: Timestamp.now(),
        };

        if (canEditRequestContent) {
          Object.assign(productionRequestData, {
            products: productsData,
            productName: legacy.productName,
            productCode: legacy.productCode,
            quantity: legacy.quantity,
            orderQuantity: hasOrderLine ? totalOrderQuantity : null,
            productionReason,
            salesRegion,
            ...(rootRequestedCompletionDate
              ? { requestedCompletionDate: Timestamp.fromDate(rootRequestedCompletionDate) }
              : {}),
          });
          if (rootCustomerName) {
            productionRequestData.customerName = rootCustomerName;
          }
          productionRequestData.memo = summarizeMemoFromProducts(productsData) || null;
        }

        // adminMemo는 값이 있을 때만 추가
        if (formData.adminMemo.trim()) {
          productionRequestData.adminMemo = formData.adminMemo.trim();
        }

        // 확정된 경우 또는 완료된 경우 완료예정일·계획수량 업데이트
        if (currentStatus === 'confirmed' || currentStatus === 'completed' || currentStatus === 'in_progress') {
          if (formData.plannedCompletionDate) {
            productionRequestData.plannedCompletionDate = Timestamp.fromDate(new Date(formData.plannedCompletionDate));
          }
          if (formData.plannedQuantity.trim()) {
            productionRequestData.plannedQuantity = parseInt(formData.plannedQuantity, 10);
          }
        }

        // 생산완료일이 입력되면 상태를 완료로 변경
        if (formData.actualCompletionDate) {
          productionRequestData.actualCompletionDate = Timestamp.fromDate(new Date(formData.actualCompletionDate));
          productionRequestData.status = 'completed';

          // 세정/EP 완료일 (생산완료일 다음에 등록)
          if (formData.cleaningEpCompletionDate) {
            productionRequestData.cleaningEpCompletionDate = Timestamp.fromDate(
              new Date(formData.cleaningEpCompletionDate)
            );
          } else {
            productionRequestData.cleaningEpCompletionDate = null;
          }
        } else if (currentStatus === 'completed' && !formData.actualCompletionDate) {
          // 생산완료일이 제거되면 상태를 확정으로 변경하고 세정/EP 완료일도 함께 제거
          productionRequestData.actualCompletionDate = null;
          productionRequestData.cleaningEpCompletionDate = null;
          productionRequestData.status = 'confirmed';
        }

        await updateDoc(
          doc(db, 'productionRequests', requestId),
          sanitizeForFirestore(productionRequestData)
        );
        setSuccess('생산요청이 성공적으로 수정되었습니다.');
        
        // 수정 후 목록 페이지로 이동
        setTimeout(() => {
          router.push('/admin/production');
        }, 1500);
        return;
      } else {
        // 등록 모드 - 관리자는 모든 사용자 대신 등록 가능하지만, 실제 사용자 정보는 필요
        // 여기서는 관리자 정보를 사용하거나, 기본값 사용
        const productionRequestData: Record<string, unknown> = {
          userId: 'admin', // 관리자 ID
          userName: '관리자',
          userEmail: 'admin@sglok.com',
          products: productsData,
          productName: legacy.productName,
          productCode: legacy.productCode,
          quantity: legacy.quantity,
          orderQuantity: hasOrderLine ? totalOrderQuantity : null,
          requestDate: Timestamp.now(),
          requestedCompletionDate: rootRequestedCompletionDate
            ? Timestamp.fromDate(rootRequestedCompletionDate)
            : Timestamp.now(),
          productionReason,
          salesRegion,
          status: 'pending_review',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: 'admin',
        };

        // customerName은 항상 저장
        if (rootCustomerName) {
          productionRequestData.customerName = rootCustomerName;
        }

        productionRequestData.memo = summarizeMemoFromProducts(productsData) || null;

        const createdRef = await addDoc(
          collection(db, 'productionRequests'),
          sanitizeForFirestore(productionRequestData)
        );
        await postAdminNotification(
          buildProductionRequestNotification({
            userName: '관리자',
            productName: legacy.productName,
            quantity: legacy.quantity,
            customerName: rootCustomerName,
            refId: createdRef.id,
          })
        );
        setSuccess('생산요청이 성공적으로 등록되었습니다.');
      }
      
      // 폼 초기화
      setFormData(INITIAL_FORM_DATA);
      setProducts([createEmptyRequestProductLine()]);

      // 2초 후 목록 페이지로 이동
      setTimeout(() => {
        router.push('/admin/production');
      }, 2000);
    } catch (error) {
      console.error('생산요청 등록 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`생산요청 등록에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {isEditMode ? '생산요청 수정' : '생산요청 등록'}
          </h1>
          <p className="text-gray-600">
            {isEditMode
              ? editProductIndex != null
                ? `선택한 제품(제품 ${editProductIndex + 1})만 수정합니다.`
                : '생산요청 정보를 수정합니다.'
              : '신규 생산요청을 등록합니다.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm p-6 space-y-6">
          <RequestProductLinesSection
            products={products}
            onProductsChange={setProducts}
            fieldErrors={fieldErrors}
            onClearFieldError={clearFieldError}
            onSetFieldError={setFieldError}
            showProductGroup
            showProductionContext
            customerNameSuggestions={customerNameSuggestions}
            showRequestedCompletionDate
            requestedCompletionDateMin={
              canEditRequestContent && !isEditMode
                ? new Date().toISOString().split('T')[0]
                : undefined
            }
            disabled={submitting || !canEditRequestContent}
            allowMultipleProducts={editProductIndex == null}
          />

          {showAdminPostReviewFields && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Input
                  id="plannedQuantity"
                  name="plannedQuantity"
                  type="number"
                  label={
                    currentStatus === 'confirmed' ||
                    currentStatus === 'completed' ||
                    currentStatus === 'in_progress'
                      ? '생산계획수량 *'
                      : '생산계획수량'
                  }
                  value={formData.plannedQuantity}
                  onChange={handleChange}
                  placeholder="생산계획수량을 입력하세요"
                  error={fieldErrors.plannedQuantity}
                  min="1"
                  required={
                    currentStatus === 'confirmed' ||
                    currentStatus === 'completed' ||
                    currentStatus === 'in_progress'
                  }
                  disabled={
                    !(
                      currentStatus === 'confirmed' ||
                      currentStatus === 'completed' ||
                      currentStatus === 'in_progress'
                    )
                  }
                />
              </div>

            {(currentStatus === 'confirmed' ||
                currentStatus === 'completed' ||
                currentStatus === 'in_progress') && (
              <div>
                <label htmlFor="plannedCompletionDate" className="block text-sm font-medium text-gray-700 mb-2">
                  완료예정일
                </label>
                <DateInput
                  id="plannedCompletionDate"
                  name="plannedCompletionDate"
                  value={formData.plannedCompletionDate}
                  onChange={handleChange}
                  disabled={true}
                  className="bg-gray-50 cursor-not-allowed opacity-50"
                />
              </div>
            )}
          </div>
          )}

          {/* 확정된 경우 또는 완료된 경우 또는 진행중인 경우 완료예정일 변경, 생산완료일 수정 가능 */}
          {showAdminPostReviewFields &&
            (currentStatus === 'confirmed' ||
              currentStatus === 'completed' ||
              currentStatus === 'in_progress') && (
            <div className="space-y-6">
              <div>
                <label htmlFor="plannedCompletionDateChange" className="block text-sm font-medium text-gray-700 mb-2">
                  완료예정일 변경
                </label>
                <DateInput
                  id="plannedCompletionDateChange"
                  name="plannedCompletionDateChange"
                  value={formData.plannedCompletionDate}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, plannedCompletionDate: e.target.value }));
                  }}
                  disabled={!!formData.actualCompletionDate}
                  className="disabled:bg-gray-50"
                />
                {formData.actualCompletionDate && (
                  <p className="mt-1 text-xs text-gray-500">생산완료일이 등록되어 있어 완료예정일을 변경할 수 없습니다.</p>
                )}
              </div>
              
              <div>
                <label htmlFor="actualCompletionDate" className="block text-sm font-medium text-gray-700 mb-2">
                  생산완료일
                </label>
                <DateInput
                  id="actualCompletionDate"
                  name="actualCompletionDate"
                  value={formData.actualCompletionDate}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      actualCompletionDate: value,
                      // 생산완료일이 없으면 세정/EP 완료일도 함께 비움
                      cleaningEpCompletionDate: value ? prev.cleaningEpCompletionDate : '',
                    }));
                  }}
                />
              </div>

              <div>
                <label htmlFor="cleaningEpCompletionDate" className="block text-sm font-medium text-gray-700 mb-2">
                  세정/EP 완료일
                </label>
                <DateInput
                  id="cleaningEpCompletionDate"
                  name="cleaningEpCompletionDate"
                  value={formData.cleaningEpCompletionDate}
                  onChange={handleChange}
                  disabled={!formData.actualCompletionDate}
                  className="disabled:bg-gray-50"
                />
                {!formData.actualCompletionDate && (
                  <p className="mt-1 text-xs text-gray-500">생산완료일을 먼저 등록해야 세정/EP 완료일을 입력할 수 있습니다.</p>
                )}
              </div>
            </div>
          )}

          {showAdminPostReviewFields && (
            <div>
              <label htmlFor="adminMemo" className="block text-sm font-medium text-gray-700 mb-2">
                관리자 비고
              </label>
              <textarea
                id="adminMemo"
                name="adminMemo"
                rows={4}
                value={formData.adminMemo}
                onChange={handleChange}
                placeholder="관리자 비고를 입력하세요."
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={submitting}
              ></textarea>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/admin/production')}
              disabled={submitting}
            >
              취소
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={submitting}
            >
              {isEditMode ? '수정' : '등록'}
            </Button>
          </div>
        </form>
      </div>
      <FormPageAlert success={success} error={error} />
    </div>
  );
}

export default function AdminProductionRequestPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    }>
      <AdminProductionRequestContent />
    </Suspense>
  );
}
