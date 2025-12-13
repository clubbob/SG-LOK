"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button, Input } from '@/components/ui';
import { collection, addDoc, Timestamp, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ProductionRequest, ProductionReason } from '@/types';

export default function ProductionRequestPage() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [formData, setFormData] = useState({
    productName: '',
    quantity: '',
    requestedCompletionDate: '',
    productionReason: 'order' as ProductionReason,
    customerName: '',
    memo: '',
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [productNameSuggestions, setProductNameSuggestions] = useState<string[]>([]);
  const [showProductSuggestions, setShowProductSuggestions] = useState(false);
  const [customerNameSuggestions, setCustomerNameSuggestions] = useState<string[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

  // 인증 확인
  React.useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

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

    if (isAuthenticated) {
      loadSuggestions();
    }
  }, [isAuthenticated]);

  if (loading) {
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
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

    if (!formData.productName.trim()) {
      errors.productName = '제품명을 입력해주세요.';
    }

    if (!formData.quantity.trim()) {
      errors.quantity = '수량을 입력해주세요.';
    } else {
      const quantityNum = parseInt(formData.quantity, 10);
      if (isNaN(quantityNum) || quantityNum <= 0) {
        errors.quantity = '수량은 1 이상의 숫자여야 합니다.';
      }
    }

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

    if (formData.productionReason === 'order' && !formData.customerName.trim()) {
      errors.customerName = '고객사명을 입력해주세요.';
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
      // Firestore에 저장할 데이터 (Timestamp 사용)
      const productionRequestData = {
        userId: userProfile.id,
        userName: userProfile.name,
        userEmail: userProfile.email,
        userCompany: userProfile.company,
        productName: formData.productName.trim(),
        quantity: parseInt(formData.quantity, 10),
        requestDate: Timestamp.now(), // 시스템에서 자동으로 현재 날짜 기록
        requestedCompletionDate: Timestamp.fromDate(new Date(formData.requestedCompletionDate)),
        productionReason: formData.productionReason,
        customerName: formData.productionReason === 'order' ? formData.customerName.trim() : undefined,
        memo: formData.memo.trim() || undefined,
        status: 'pending_review',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdBy: userProfile.id,
      };

      await addDoc(collection(db, 'productionRequests'), productionRequestData);

      setSuccess('생산요청이 성공적으로 등록되었습니다.');
      
      // 폼 초기화
      setFormData({
        productName: '',
        quantity: '',
        requestedCompletionDate: '',
        productionReason: 'order',
        customerName: '',
        memo: '',
      });

      // 2초 후 목록 페이지로 이동 (또는 현재 페이지 유지)
      setTimeout(() => {
        setSuccess('');
      }, 3000);
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">생산요청 등록</h1>
            <p className="text-gray-600">신규 생산요청을 등록합니다.</p>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  label="수량 *"
                  value={formData.quantity}
                  onChange={handleChange}
                  placeholder="수량을 입력하세요"
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="productionReason" className="block text-sm font-medium text-gray-700 mb-2">
                  생산이유 *
                </label>
                <select
                  id="productionReason"
                  name="productionReason"
                  value={formData.productionReason}
                  onChange={handleChange}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  <option value="order">주문</option>
                  <option value="inventory">재고</option>
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
            </div>

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
                등록
              </Button>
            </div>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}

