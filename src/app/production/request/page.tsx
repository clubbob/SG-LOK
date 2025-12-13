"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button, Input } from '@/components/ui';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
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
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 인증 확인
  React.useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

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
            <div>
              <Input
                id="productName"
                name="productName"
                type="text"
                label="제품명 *"
                value={formData.productName}
                onChange={handleChange}
                placeholder="제품명을 입력하세요"
                error={fieldErrors.productName}
                required
              />
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
                <div>
                  <Input
                    id="customerName"
                    name="customerName"
                    type="text"
                    label="고객사명 *"
                    value={formData.customerName}
                    onChange={handleChange}
                    placeholder="고객사명을 입력하세요"
                    error={fieldErrors.customerName}
                    required
                  />
                </div>
              )}
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

