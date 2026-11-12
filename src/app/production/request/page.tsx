"use client";

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button, FormPageAlert } from '@/components/ui';
import {
  collection,
  addDoc,
  Timestamp,
  getDocs,
  query,
  where,
  limit,
  doc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeForFirestore } from '@/lib/firestoreSanitize';
import {
  buildProductionRequestNotification,
  postAdminNotification,
} from '@/lib/adminNotifications';
import { RequestProductLinesSection } from '@/components/products/RequestProductLinesSection';
import {
  isProductionRequestContentEditable,
  normalizeProductionRequestStatus,
} from '@/lib/production/productionRequestDisplay';
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
import {
  enrichProductsWithDrawingAttachments,
  mergeDrawingFromRequestLines,
  productionLinesHaveDrawingWork,
  productsWithSerializedDrawings,
} from '@/lib/production/productionDrawingAttachment';
import type { CertificateProduct } from '@/types';
import { ProductionMachineSelect } from '@/components/production/ProductionMachineSelect';
import { useProductionMachines } from '@/hooks/useProductionMachines';

function ProductionRequestPageFrame({
  children,
  showLoading = false,
}: {
  children?: React.ReactNode;
  showLoading?: boolean;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        {showLoading ? (
          <div className="flex min-h-[50vh] items-center justify-center px-4">
            <div className="text-center" aria-live="polite" aria-busy="true">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
              <p className="mt-3 text-sm text-gray-600">불러오는 중...</p>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
      <Footer />
    </div>
  );
}

function ProductionRequestContent() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get('id');
  const productIndexParam = searchParams.get('productIndex');
  const isEditRoute = Boolean(requestId);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editProductIndex, setEditProductIndex] = useState<number | null>(null);
  const allProductLinesRef = useRef<RequestProductLine[] | null>(null);
  const [loadingRequest, setLoadingRequest] = useState(isEditRoute);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [products, setProducts] = useState<RequestProductLine[]>([createEmptyRequestProductLine()]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [customerNameSuggestions, setCustomerNameSuggestions] = useState<string[]>([]);
  const [machineNo, setMachineNo] = useState('');
  const { machines: productionMachines, loading: loadingProductionMachines } = useProductionMachines(
    isAuthenticated
  );

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

  React.useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (!requestId) {
      setLoadingRequest(false);
      return;
    }
    if (!isAuthenticated || !userProfile) {
      return;
    }

    let cancelled = false;

    const loadRequestData = async () => {
      setLoadingRequest(true);
      try {
        const requestDoc = await getDoc(doc(db, 'productionRequests', requestId));
        if (!requestDoc.exists()) {
          if (!cancelled) {
            setError('생산요청을 찾을 수 없습니다.');
            router.replace('/production/list');
          }
          return;
        }

        const data = requestDoc.data();
        if (data.userId !== userProfile.id) {
          if (!cancelled) {
            setError('본인이 요청한 생산요청만 수정할 수 있습니다.');
            router.replace('/production/list');
          }
          return;
        }

        const docStatus = normalizeProductionRequestStatus(data.status);
        const rawProducts = Array.isArray(data.products) ? data.products : [];
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

        const multiProduct = allLines.length > 1;
        const lineIdx = singleLineIndex ?? 0;
        const lineDoc = rawProducts[lineIdx] as { lineStatus?: string; machineNo?: string } | undefined;
        const lineStatus = normalizeProductionRequestStatus(lineDoc?.lineStatus ?? docStatus);
        const editableStatus = singleLineIndex != null ? lineStatus : docStatus;
        if (!isProductionRequestContentEditable(editableStatus)) {
          if (!cancelled) {
            setError('승인 대기 중인 요청만 수정할 수 있습니다.');
            router.replace('/production/list');
          }
          return;
        }

        if (cancelled) return;
        setIsEditMode(true);
        setEditProductIndex(singleLineIndex);
        setProducts(singleLineIndex != null ? [allLines[singleLineIndex]] : allLines);
        setMachineNo(
          (typeof lineDoc?.machineNo === 'string' ? lineDoc.machineNo : '') ||
            (!multiProduct && typeof data.machineNo === 'string' ? data.machineNo : '')
        );
      } catch (err) {
        console.error('생산요청 로드 오류:', err);
        if (!cancelled) {
          setError('생산요청을 불러오는데 실패했습니다.');
          router.replace('/production/list');
        }
      } finally {
        if (!cancelled) {
          setLoadingRequest(false);
        }
      }
    };

    void loadRequestData();
    return () => {
      cancelled = true;
    };
  }, [requestId, productIndexParam, isAuthenticated, userProfile, router]);

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
      } catch (err) {
        console.error('고객사명 목록 로드 오류:', err);
      }
    };

    if (isAuthenticated && userProfile?.id) {
      loadSuggestions();
    }
  }, [isAuthenticated, userProfile?.id]);

  const authPending = loading || (isAuthenticated && !userProfile);
  const editDataPending = isEditRoute && !isEditMode;
  const showPageLoading = authPending || loadingRequest || editDataPending;

  if (!loading && !isAuthenticated) {
    return null;
  }

  if (showPageLoading) {
    return <ProductionRequestPageFrame showLoading />;
  }

  if (!userProfile) {
    return null;
  }

  const applyMachineNoToProducts = (items: CertificateProduct[]): CertificateProduct[] => {
    const trimmed = machineNo.trim();
    const patch = (p: CertificateProduct): CertificateProduct =>
      trimmed ? { ...p, machineNo: trimmed } : { ...p, machineNo: '' };
    if (editProductIndex != null) {
      return items.map((p, i) => (i === editProductIndex ? patch(p) : p));
    }
    return items.map(patch);
  };

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
      let productsData = buildCertificateProductsFromLines(linesForSave);
      if (productsData.length === 0) {
        setError('제품 정보를 입력해주세요.');
        setSubmitting(false);
        return;
      }
      productsData = applyMachineNoToProducts(productsData);
      const machineNoTrimmed = machineNo.trim();
      const legacy = summarizeProductionLegacyFromProducts(productsData);
      const rootMeta = summarizeProductionRequestRootFromProducts(productsData);
      const hasOrderLine = productsData.some((p) => p.productionReason === 'order');
      const totalOrderQuantity = summarizeOrderQuantityFromOrderLines(productsData);
      const rootRequestedCompletionDate = summarizeRequestedCompletionDateFromProducts(productsData);
      const { productionReason, salesRegion, customerName: rootCustomerName } = rootMeta;

      if (isEditMode && requestId) {
        let saveProducts = mergeDrawingFromRequestLines(linesForSave, productsData);
        if (productionLinesHaveDrawingWork(linesForSave)) {
          try {
            saveProducts = await enrichProductsWithDrawingAttachments(linesForSave, saveProducts, {
              requestId,
              uploadedBy: userProfile.id,
            });
          } catch (uploadErr) {
            console.error('도면 업로드 오류:', uploadErr);
            const msg = uploadErr instanceof Error ? uploadErr.message : '알 수 없는 오류';
            setError(`도면 저장에 실패했습니다: ${msg}`);
            setSubmitting(false);
            return;
          }
        }

        const productionRequestData: Record<string, unknown> = {
          products: productsWithSerializedDrawings(saveProducts),
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

        if (rootCustomerName) {
          productionRequestData.customerName = rootCustomerName;
        }
        productionRequestData.memo = summarizeMemoFromProducts(productsData) || null;
        if (saveProducts.length === 1) {
          productionRequestData.machineNo = machineNoTrimmed || null;
        }

        await updateDoc(
          doc(db, 'productionRequests', requestId),
          sanitizeForFirestore(productionRequestData)
        );
        setSuccess('생산요청이 수정되었습니다.');

        setTimeout(() => {
          router.push('/production/list');
        }, 1500);
        return;
      }

      const createProducts = mergeDrawingFromRequestLines(linesForSave, productsData);
      const productionRequestData: Record<string, unknown> = {
        userId: userProfile.id,
        userName: userProfile.name,
        userEmail: userProfile.email,
        userCompany: userProfile.company,
        products: createProducts,
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
        createdBy: userProfile.id,
      };

      if (rootCustomerName) {
        productionRequestData.customerName = rootCustomerName;
      }
      productionRequestData.memo = summarizeMemoFromProducts(productsData) || null;
      if (createProducts.length === 1 && machineNoTrimmed) {
        productionRequestData.machineNo = machineNoTrimmed;
      }

      const createdRef = await addDoc(
        collection(db, 'productionRequests'),
        sanitizeForFirestore(productionRequestData)
      );

      if (productionLinesHaveDrawingWork(linesForSave)) {
        try {
          const withDrawings = await enrichProductsWithDrawingAttachments(
            linesForSave,
            createProducts,
            { requestId: createdRef.id, uploadedBy: userProfile.id }
          );
          await updateDoc(
            doc(db, 'productionRequests', createdRef.id),
            sanitizeForFirestore({
              products: productsWithSerializedDrawings(withDrawings),
              updatedAt: Timestamp.now(),
            })
          );
        } catch (uploadErr) {
          console.error('도면 업로드 오류:', uploadErr);
          const msg = uploadErr instanceof Error ? uploadErr.message : '알 수 없는 오류';
          setError(
            `요청은 등록되었으나 도면 저장에 실패했습니다. 현황에서 수정하여 다시 첨부해 주세요: ${msg}`
          );
          setSubmitting(false);
          return;
        }
      }

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

      setTimeout(() => {
        router.push('/production/list');
      }, 1500);
    } catch (err) {
      console.error('생산요청 저장 오류:', err);
      const firebaseError = err as { code?: string; message?: string };
      setError(`저장에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ProductionRequestPageFrame>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {isEditMode ? '생산요청 수정' : '생산요청 등록'}
            </h1>
            <p className="text-gray-600">
              {isEditMode
                ? editProductIndex != null
                  ? `선택한 제품(제품 ${editProductIndex + 1})의 요청 내용을 수정합니다. (승인 대기 중만 가능)`
                  : '요청 내용을 수정합니다. (승인 대기 중만 가능)'
                : '신규 생산요청을 등록합니다. 등록 후 진행 상태는 현황에서 확인할 수 있습니다.'}
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
              productLineDisplayStart={editProductIndex != null ? editProductIndex + 1 : 1}
              showDrawingAttachment
            />

            <div className="max-w-md border-t border-gray-200 pt-6">
              <ProductionMachineSelect
                id="machineNo"
                label="기계명"
                value={machineNo}
                machines={productionMachines}
                loading={loadingProductionMachines}
                disabled={submitting}
                onChange={(value) => {
                  setMachineNo(value);
                  clearFieldError('machineNo');
                }}
              />
              <p className="mt-2 text-xs text-gray-500">
                {editProductIndex != null
                  ? '선택한 제품 줄에 반영됩니다. 미선택 시 비워 둡니다.'
                  : '요청에 포함된 모든 제품에 동일하게 반영됩니다. 미선택 시 비워 둡니다.'}
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/production/list')}
                disabled={submitting}
              >
                취소
              </Button>
              <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
                {isEditMode ? '수정 저장' : '등록'}
              </Button>
            </div>
          </form>
        </div>
      <FormPageAlert success={success} error={error} />
    </ProductionRequestPageFrame>
  );
}

export default function ProductionRequestPage() {
  return (
    <Suspense fallback={<ProductionRequestPageFrame showLoading />}>
      <ProductionRequestContent />
    </Suspense>
  );
}
