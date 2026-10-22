"use client";

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button, FormPageAlert } from '@/components/ui';
import { collection, addDoc, Timestamp, getDocs, query, where, limit, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeForFirestore } from '@/lib/firestoreSanitize';
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

function ProductionRequestContent() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get('id');
  const productIndexParam = searchParams.get('productIndex');
  const [isEditMode, setIsEditMode] = useState(false);
  const [editProductIndex, setEditProductIndex] = useState<number | null>(null);
  const allProductLinesRef = useRef<RequestProductLine[] | null>(null);
  const [loadingRequest, setLoadingRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [products, setProducts] = useState<RequestProductLine[]>([createEmptyRequestProductLine()]);

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

  // 인증 확인
  React.useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  // 수정 모드: 기존 데이터 불러오기
  useEffect(() => {
    const loadRequestData = async () => {
      if (!requestId || !isAuthenticated || !userProfile) return;

      setLoadingRequest(true);
      try {
        const requestDoc = await getDoc(doc(db, 'productionRequests', requestId));
        if (requestDoc.exists()) {
          const data = requestDoc.data();
          // 본인이 작성한 요청만 수정 가능
          if (data.userId !== userProfile.id) {
            setError('본인이 작성한 생산요청만 수정할 수 있습니다.');
            router.push('/production/list');
            return;
          }
          
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
          setEditProductIndex(singleLineIndex);
          setProducts(singleLineIndex != null ? [allLines[singleLineIndex]] : allLines);
        } else {
          setError('생산요청을 찾을 수 없습니다.');
          router.push('/production/list');
        }
      } catch (error) {
        console.error('생산요청 로드 오류:', error);
        setError('생산요청을 불러오는데 실패했습니다.');
      } finally {
        setLoadingRequest(false);
      }
    };

    if (requestId && isAuthenticated && userProfile) {
      loadRequestData();
    }
  }, [requestId, productIndexParam, isAuthenticated, userProfile, router]);

  // 이전에 등록된 고객사명 목록 (본인 생산요청)
  useEffect(() => {
    const loadSuggestions = async () => {
      if (!userProfile?.id) return;
      try {
        const productionRequestsRef = collection(db, 'productionRequests');
        const q = query(productionRequestsRef, where('userId', '==', userProfile.id), limit(500));
        const querySnapshot = await getDocs(q);
        const customerNames = new Set<string>();
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
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

    if (isAuthenticated && userProfile?.id) {
      loadSuggestions();
    }
  }, [isAuthenticated, userProfile?.id]);

  if (loading || loadingRequest) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !userProfile) {
    return null;
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    Object.assign(
      errors,
      validateRequestProductLines(products, {
        requireProductGroup: true,
        requireProductionContext: true,
        requireRequestedCompletionDate: true,
        allowPastRequestedCompletionDate: isEditMode,
      })
    );

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
      if (productsData.length === 0) {
        setError('제품 정보를 입력해주세요.');
        setSubmitting(false);
        return;
      }
      const legacy = summarizeProductionLegacyFromProducts(productsData);
      const rootMeta = summarizeProductionRequestRootFromProducts(productsData);
      const hasOrderLine = productsData.some((p) => p.productionReason === 'order');
      const totalOrderQuantity = summarizeOrderQuantityFromOrderLines(productsData);
      const rootRequestedCompletionDate = summarizeRequestedCompletionDateFromProducts(productsData);
      const { productionReason, salesRegion, customerName: rootCustomerName } = rootMeta;

      if (isEditMode && requestId) {
        // 수정 모드
        const productionRequestData: Record<string, unknown> = {
          products: productsData,
          productName: legacy.productName,
          productCode: legacy.productCode,
          quantity: legacy.quantity,
          orderQuantity: hasOrderLine ? totalOrderQuantity : null,
          ...(rootRequestedCompletionDate
            ? { requestedCompletionDate: Timestamp.fromDate(rootRequestedCompletionDate) }
            : {}),
          productionReason,
          salesRegion,
          updatedAt: Timestamp.now(),
        };

        // customerName은 항상 저장
        if (rootCustomerName) {
          productionRequestData.customerName = rootCustomerName;
        }
        productionRequestData.memo = summarizeMemoFromProducts(productsData) || null;

        await updateDoc(
          doc(db, 'productionRequests', requestId),
          sanitizeForFirestore(productionRequestData)
        );
        setSuccess('생산요청이 성공적으로 수정되었습니다.');
        
        // 수정 후 목록 페이지로 이동
        setTimeout(() => {
          router.push('/production/list');
        }, 1500);
        return;
      } else {
        // 등록 모드
        const productionRequestData: Record<string, unknown> = {
          userId: userProfile.id,
          userName: userProfile.name,
          userEmail: userProfile.email,
          userCompany: userProfile.company,
          products: productsData,
          productName: legacy.productName,
          productCode: legacy.productCode,
          quantity: legacy.quantity,
          orderQuantity: hasOrderLine ? totalOrderQuantity : null,
          requestDate: Timestamp.now(), // 시스템에서 자동으로 현재 날짜 기록
          requestedCompletionDate: rootRequestedCompletionDate
            ? Timestamp.fromDate(rootRequestedCompletionDate)
            : Timestamp.now(),
          productionReason,
          salesRegion,
          status: 'pending_review',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: userProfile.id,
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
            userName: userProfile.name || '사용자',
            productName: legacy.productName,
            quantity: legacy.quantity,
            customerName: rootCustomerName,
            refId: createdRef.id,
          })
        );
        setSuccess('생산요청이 성공적으로 등록되었습니다.');
        
        // 등록 후 목록 페이지로 이동
        setTimeout(() => {
          router.push('/production/list');
        }, 1500);
        return;
      }
      
      setProducts([createEmptyRequestProductLine()]);
    } catch (error) {
      console.error('생산요청 등록 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`생산요청 등록에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
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
                isEditMode ? undefined : new Date().toISOString().split('T')[0]
              }
              disabled={submitting}
              allowMultipleProducts={editProductIndex == null}
            />

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
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
      </main>
      <Footer />
    </div>
  );
}

export default function ProductionRequestPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    }>
      <ProductionRequestContent />
    </Suspense>
  );
}

