"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, addDoc, Timestamp, getDocs, query, limit, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ProductionReason } from '@/types';

const ADMIN_SESSION_KEY = 'admin_session';

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
  const [isEditMode, setIsEditMode] = useState(false);
  const [loadingRequest, setLoadingRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [formData, setFormData] = useState({
    productName: '',
    quantity: '',
    orderQuantity: '',
    requestedCompletionDate: '',
    productionReason: 'order' as ProductionReason,
    customerName: '',
    memo: '',
    plannedCompletionDate: '',
    productionLine: '',
    actualCompletionDate: '',
  });
  const [currentStatus, setCurrentStatus] = useState<string>('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [productNameSuggestions, setProductNameSuggestions] = useState<string[]>([]);
  const [showProductSuggestions, setShowProductSuggestions] = useState(false);
  const [customerNameSuggestions, setCustomerNameSuggestions] = useState<string[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

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
          
          setIsEditMode(true);
          setCurrentStatus(data.status || 'pending_review');
          setFormData({
            productName: data.productName || '',
            quantity: data.quantity?.toString() || '',
            orderQuantity: data.orderQuantity?.toString() || '',
            requestedCompletionDate: data.requestedCompletionDate?.toDate().toISOString().split('T')[0] || '',
            productionReason: data.productionReason || 'order',
            customerName: data.customerName || '',
            memo: data.memo || '',
            plannedCompletionDate: data.plannedCompletionDate?.toDate().toISOString().split('T')[0] || '',
            productionLine: data.productionLine || '',
            actualCompletionDate: data.actualCompletionDate?.toDate().toISOString().split('T')[0] || '',
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
  }, [requestId, router]);

  // 이전에 등록된 제품명 및 고객사명 목록 불러오기
  useEffect(() => {
    const loadSuggestions = async () => {
      try {
        const productionRequestsRef = collection(db, 'productionRequests');
        const q = query(productionRequestsRef, limit(500)); // 인덱스 없이 사용, 최대 500개
        const querySnapshot = await getDocs(q);
        
        const productNames = new Set<string>();
        const customerNames = new Set<string>();
        
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.productName && typeof data.productName === 'string') {
            productNames.add(data.productName);
          }
          if (data.customerName && typeof data.customerName === 'string') {
            customerNames.add(data.customerName);
          }
        });
        
        // 클라이언트 측에서 정렬
        setProductNameSuggestions(Array.from(productNames).sort());
        setCustomerNameSuggestions(Array.from(customerNames).sort());
      } catch (error) {
        console.error('제품명/고객사명 목록 로드 오류:', error);
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name } = e.target;
    let { value } = e.target;

    // 제품명은 영문 입력 시 대문자로 변환
    if (name === 'productName') {
      value = value.toUpperCase();
    }
    setFormData({
      ...formData,
      [name]: value
    });
    
    // 제품명 입력 시 자동완성 표시
    if (name === 'productName') {
      setShowProductSuggestions(value.length > 0);
    }
    
    // 고객사명 입력 시 자동완성 표시
    if (name === 'customerName') {
      setShowCustomerSuggestions(value.length > 0);
    }
    
    // 필드별 에러 초기화
    if (fieldErrors[name]) {
      setFieldErrors({
        ...fieldErrors,
        [name]: ''
      });
    }
    if (error) setError('');
    if (success) setSuccess('');
  };

  const handleProductNameSelect = (productName: string) => {
    setFormData({
      ...formData,
      productName: productName
    });
    setShowProductSuggestions(false);
  };

  const handleCustomerNameSelect = (customerName: string) => {
    setFormData({
      ...formData,
      customerName: customerName
    });
    setShowCustomerSuggestions(false);
  };

  // 필터링된 제품명 제안 목록
  const filteredProductSuggestions = productNameSuggestions.filter(name =>
    name.toLowerCase().includes(formData.productName.toLowerCase())
  ).slice(0, 10); // 최대 10개만 표시

  // 필터링된 고객사명 제안 목록
  const filteredCustomerSuggestions = customerNameSuggestions.filter(name =>
    name.toLowerCase().includes(formData.customerName.toLowerCase())
  ).slice(0, 10); // 최대 10개만 표시

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    // 1) 제품명
    if (!formData.productName.trim()) {
      errors.productName = '제품명을 입력해주세요.';
    }

    // 2) 생산목적이 주문인 경우 고객사명/수주량 필수
    if (formData.productionReason === 'order') {
      if (!formData.customerName.trim()) {
        errors.customerName = '고객사명을 입력해주세요.';
      }
      if (!formData.orderQuantity.trim()) {
        errors.orderQuantity = '수주수량을 입력해주세요.';
      } else {
        const orderQtyNum = parseInt(formData.orderQuantity, 10);
        if (isNaN(orderQtyNum) || orderQtyNum <= 0) {
          errors.orderQuantity = '수주수량은 1 이상의 숫자여야 합니다.';
        }
      }
    }

    // 3) 생산수량
    if (!formData.quantity.trim()) {
      errors.quantity = '생산수량을 입력해주세요.';
    } else {
      const quantityNum = parseInt(formData.quantity, 10);
      if (isNaN(quantityNum) || quantityNum <= 0) {
        errors.quantity = '생산수량은 1 이상의 숫자여야 합니다.';
      }
    }

    // 4) 완료요청일
    if (!formData.requestedCompletionDate) {
      errors.requestedCompletionDate = '완료요청일을 선택해주세요.';
    } else {
      const completionDate = new Date(formData.requestedCompletionDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (completionDate < today) {
        errors.requestedCompletionDate = '완료요청일은 오늘 이후여야 합니다.';
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
      if (isEditMode && requestId) {
        // 수정 모드
        const productionRequestData: Record<string, unknown> = {
          productName: formData.productName.trim(),
          quantity: parseInt(formData.quantity, 10),
          orderQuantity: formData.productionReason === 'order' && formData.orderQuantity.trim()
            ? parseInt(formData.orderQuantity, 10)
            : null,
          requestedCompletionDate: Timestamp.fromDate(new Date(formData.requestedCompletionDate)),
          productionReason: formData.productionReason,
          updatedAt: Timestamp.now(),
        };

        // customerName은 주문인 경우에만 추가
        if (formData.productionReason === 'order' && formData.customerName.trim()) {
          productionRequestData.customerName = formData.customerName.trim();
        }
        if (formData.productionReason === 'order' && formData.orderQuantity.trim()) {
          productionRequestData.orderQuantity = parseInt(formData.orderQuantity, 10);
        }
        if (formData.productionReason === 'order' && formData.orderQuantity.trim()) {
          productionRequestData.orderQuantity = parseInt(formData.orderQuantity, 10);
        }

        // memo는 값이 있을 때만 추가
        if (formData.memo.trim()) {
          productionRequestData.memo = formData.memo.trim();
        }

        // 확정된 경우 또는 완료된 경우 완료예정일과 생산라인도 업데이트
        if (currentStatus === 'confirmed' || currentStatus === 'completed') {
          if (formData.plannedCompletionDate) {
            productionRequestData.plannedCompletionDate = Timestamp.fromDate(new Date(formData.plannedCompletionDate));
          }
          if (formData.productionLine) {
            productionRequestData.productionLine = formData.productionLine.trim();
          }
          // 생산완료일이 입력되면 상태를 완료로 변경
          if (formData.actualCompletionDate) {
            productionRequestData.actualCompletionDate = Timestamp.fromDate(new Date(formData.actualCompletionDate));
            productionRequestData.status = 'completed';
          } else if (currentStatus === 'completed' && !formData.actualCompletionDate) {
            // 생산완료 상태인데 생산완료일이 삭제되면 상태를 확정으로 변경
            productionRequestData.status = 'confirmed';
          }
        }

        await updateDoc(doc(db, 'productionRequests', requestId), productionRequestData);
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
          productName: formData.productName.trim(),
          quantity: parseInt(formData.quantity, 10),
          orderQuantity:
            formData.productionReason === 'order' && formData.orderQuantity.trim()
              ? parseInt(formData.orderQuantity, 10)
              : null,
          requestDate: Timestamp.now(),
          requestedCompletionDate: Timestamp.fromDate(new Date(formData.requestedCompletionDate)),
          productionReason: formData.productionReason,
          status: 'pending_review',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: 'admin',
        };

        // customerName은 주문인 경우에만 추가
        if (formData.productionReason === 'order' && formData.customerName.trim()) {
          productionRequestData.customerName = formData.customerName.trim();
        }

        // memo는 값이 있을 때만 추가
        if (formData.memo.trim()) {
          productionRequestData.memo = formData.memo.trim();
        }

        await addDoc(collection(db, 'productionRequests'), productionRequestData);
        setSuccess('생산요청이 성공적으로 등록되었습니다.');
      }
      
      // 폼 초기화
      setFormData({
        productName: '',
        quantity: '',
        orderQuantity: '',
        requestedCompletionDate: '',
        productionReason: 'order',
        customerName: '',
        memo: '',
        plannedCompletionDate: '',
        productionLine: '',
        actualCompletionDate: '',
      });

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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {isEditMode ? '생산요청 수정' : '생산요청 등록'}
          </h1>
          <p className="text-gray-600">
            {isEditMode ? '생산요청 정보를 수정합니다.' : '신규 생산요청을 등록합니다.'}
          </p>
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

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm p-6 space-y-6">
          <div className="relative">
            <Input
              id="productName"
              name="productName"
              type="text"
              label="제품명 *"
              value={formData.productName}
              onChange={handleChange}
              onFocus={() => setShowProductSuggestions(formData.productName.length > 0)}
              onBlur={() => setTimeout(() => setShowProductSuggestions(false), 200)}
              placeholder="제품명을 입력하거나 선택하세요"
              error={fieldErrors.productName}
              required
              list="productNameList"
            />
            <datalist id="productNameList">
              {productNameSuggestions.map((name, index) => (
                <option key={index} value={name} />
              ))}
            </datalist>
            
            {/* 커스텀 자동완성 드롭다운 (datalist가 브라우저마다 다르게 동작할 수 있어서) */}
            {showProductSuggestions && filteredProductSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                {filteredProductSuggestions.map((name: string, index: number) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleProductNameSelect(name)}
                    className="w-full text-left px-4 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label htmlFor="productionReason" className="block text-sm font-medium text-gray-700 mb-2">
                생산목적 *
              </label>
              <select
                id="productionReason"
                name="productionReason"
                value={formData.productionReason}
                onChange={handleChange}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <option value="order">고객 주문</option>
                <option value="inventory">재고 준비</option>
              </select>
            </div>

            {formData.productionReason === 'order' && (
              <div className="relative">
                <Input
                  id="customerName"
                  name="customerName"
                  type="text"
                  label="고객사명 *"
                  value={formData.customerName}
                  onChange={handleChange}
                  onFocus={() => setShowCustomerSuggestions(formData.customerName.length > 0)}
                  onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 200)}
                  placeholder="고객사명을 입력하거나 선택하세요"
                  error={fieldErrors.customerName}
                  required
                  list="customerNameList"
                />
                <datalist id="customerNameList">
                  {customerNameSuggestions.map((name, index) => (
                    <option key={index} value={name} />
                  ))}
                </datalist>
                
                {/* 커스텀 자동완성 드롭다운 */}
                {showCustomerSuggestions && filteredCustomerSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                    {filteredCustomerSuggestions.map((name, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => handleCustomerNameSelect(name)}
                        className="w-full text-left px-4 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {formData.productionReason === 'order' && (
              <div>
                <Input
                  id="orderQuantity"
                  name="orderQuantity"
                  type="number"
                  label="수주수량 *"
                  value={formData.orderQuantity}
                  onChange={handleChange}
                  placeholder="수주수량을 입력하세요"
                  error={fieldErrors.orderQuantity}
                  min="1"
                  required
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                label="생산수량 *"
                value={formData.quantity}
                onChange={handleChange}
                placeholder="생산수량을 입력하세요"
                error={fieldErrors.quantity}
                min="1"
                required
              />
            </div>

            <div>
              <Input
                id="requestedCompletionDate"
                name="requestedCompletionDate"
                type="date"
                label="완료요청일 *"
                value={formData.requestedCompletionDate}
                onChange={handleChange}
                error={fieldErrors.requestedCompletionDate}
                min={new Date().toISOString().split('T')[0]}
                required
              />
            </div>
          </div>

          {/* 확정된 경우 또는 완료된 경우 완료예정일, 생산라인, 생산완료일 수정 가능 */}
          {isEditMode && (currentStatus === 'confirmed' || currentStatus === 'completed') && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="plannedCompletionDate" className="block text-sm font-medium text-gray-700 mb-2">
                  완료예정일
                </label>
                <input
                  type="date"
                  id="plannedCompletionDate"
                  name="plannedCompletionDate"
                  value={formData.plannedCompletionDate}
                  onChange={handleChange}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                />
              </div>
              <div>
                <label htmlFor="productionLine" className="block text-sm font-medium text-gray-700 mb-2">
                  생산라인
                </label>
                <input
                  type="text"
                  id="productionLine"
                  name="productionLine"
                  value={formData.productionLine}
                  onChange={handleChange}
                  placeholder="생산라인을 입력하세요 (예: 라인1, 라인2)"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                />
              </div>
              <div>
                <label htmlFor="actualCompletionDate" className="block text-sm font-medium text-gray-700 mb-2">
                  생산완료일
                </label>
                <input
                  type="date"
                  id="actualCompletionDate"
                  name="actualCompletionDate"
                  value={formData.actualCompletionDate}
                  onChange={handleChange}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                />
                <p className="mt-1 text-xs text-gray-500">생산완료일을 입력하면 상태가 완료로 변경됩니다.</p>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="memo" className="block text-sm font-medium text-gray-700 mb-2">
              비고
            </label>
            <textarea
              id="memo"
              name="memo"
              value={formData.memo}
              onChange={handleChange}
              rows={4}
              placeholder="비고를 입력하세요"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 resize-none"
            />
          </div>

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
