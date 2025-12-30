"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button, Input } from '@/components/ui';
import { collection, addDoc, Timestamp, doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { CertificateType, InquiryAttachment, CertificateProduct, CertificateAttachment } from '@/types';

const CERTIFICATE_TYPES: { value: CertificateType; label: string }[] = [
  { value: 'quality', label: '품질' },
  { value: 'safety', label: '안전' },
  { value: 'environmental', label: '환경' },
  { value: 'other', label: '기타' },
];

function CertificateRequestContent() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get('id');
  const [isEditMode, setIsEditMode] = useState(false);
  const [loadingRequest, setLoadingRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  
  // 오늘 날짜를 YYYY-MM-DD 형식으로 변환
  const today = new Date().toISOString().split('T')[0];
  
  const [formData, setFormData] = useState({
    customerName: '',
    orderNumber: '',
    requestedCompletionDate: '',
    memo: '',
  });

  // 제품 배열 (제품명, 제품코드, 수량 셋트)
  const [products, setProducts] = useState<Array<{
    productName: string;
    productCode: string;
    quantity: string;
  }>>([{ productName: '', productCode: '', quantity: '' }]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 인증 확인
  useEffect(() => {
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
        const requestDoc = await getDoc(doc(db, 'certificates', requestId));
        if (requestDoc.exists()) {
          const data = requestDoc.data();
          // 본인이 작성한 요청만 수정 가능
          if (data.userId !== userProfile.id) {
            setError('본인이 작성한 성적서 요청만 수정할 수 있습니다.');
            router.push('/certificate/list');
            return;
          }
          
          setIsEditMode(true);
          setFormData({
            customerName: data.customerName || '',
            orderNumber: data.orderNumber || '',
            requestedCompletionDate: data.requestedCompletionDate?.toDate().toISOString().split('T')[0] || '',
            memo: data.memo || '',
          });
          
          // 제품 데이터 로드 (products 배열이 있으면 사용, 없으면 기존 단일 제품 필드 사용)
          if (data.products && Array.isArray(data.products) && data.products.length > 0) {
            setProducts(data.products.map((p: CertificateProduct) => ({
              productName: p.productName || '',
              productCode: p.productCode || '',
              quantity: p.quantity?.toString() || '',
            })));
          } else if (data.productName || data.productCode || data.quantity) {
            // 기존 단일 제품 데이터를 배열로 변환
            setProducts([{
              productName: data.productName || '',
              productCode: data.productCode || '',
              quantity: data.quantity?.toString() || '',
            }]);
          }
        } else {
          setError('성적서 요청을 찾을 수 없습니다.');
          router.push('/certificate/list');
        }
      } catch (error) {
        console.error('성적서 요청 로드 오류:', error);
        setError('성적서 요청을 불러오는데 실패했습니다.');
      } finally {
        setLoadingRequest(false);
      }
    };

    if (requestId && isAuthenticated && userProfile) {
      loadRequestData();
    }
  }, [requestId, isAuthenticated, userProfile, router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    // 고객명, 발주번호는 영문을 대문자로 변환
    const fieldsToUpperCase = ['customerName', 'orderNumber'];
    const processedValue = fieldsToUpperCase.includes(name) ? value.toUpperCase() : value;
    setFormData(prev => ({ ...prev, [name]: processedValue }));
    
    // 필드 에러 초기화
    if (fieldErrors[name]) {
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
    if (error) setError('');
  };

  // 제품 필드 변경 핸들러
  const handleProductChange = (index: number, field: 'productName' | 'productCode' | 'quantity', value: string) => {
    setProducts(prev => {
      const newProducts = [...prev];
      if (field === 'quantity') {
        // 수량은 숫자만 허용
        newProducts[index] = { ...newProducts[index], [field]: value.replace(/[^0-9]/g, '') };
      } else {
        // 제품명, 제품코드는 대문자로 변환
        newProducts[index] = { ...newProducts[index], [field]: value.toUpperCase() };
      }
      return newProducts;
    });
  };

  // 제품 추가 (이전 제품 내용 복사)
  const handleAddProduct = () => {
    setProducts(prev => {
      const lastProduct = prev[prev.length - 1];
      // 마지막 제품의 내용을 복사
      const newProduct = {
        productName: lastProduct?.productName || '',
        productCode: lastProduct?.productCode || '',
        quantity: lastProduct?.quantity || '',
      };
      return [...prev, newProduct];
    });
  };

  // 제품 삭제
  const handleRemoveProduct = (index: number) => {
    if (products.length > 1) {
      setProducts(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      // 최대 3개 파일 제한
      if (attachedFiles.length + files.length > 3) {
        setError('최대 3개까지 파일을 첨부할 수 있습니다.');
        return;
      }
      // 파일 크기 제한 (10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      const oversizedFiles = files.filter(file => file.size > maxSize);
      if (oversizedFiles.length > 0) {
        setError('파일 크기는 10MB를 초과할 수 없습니다.');
        return;
      }
      setAttachedFiles(prev => [...prev, ...files]);
      if (error) setError('');
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    // 고객명 필수
    if (!formData.customerName.trim()) {
      errors.customerName = '고객명을 입력해주세요.';
    }

    // 완료요청일 필수
    if (!formData.requestedCompletionDate.trim()) {
      errors.requestedCompletionDate = '완료요청일을 선택해주세요.';
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

    if (!userProfile) {
      setError('사용자 정보를 불러올 수 없습니다.');
      setSubmitting(false);
      return;
    }

    try {
      // 파일 업로드
      let attachments: InquiryAttachment[] = [];
      if (attachedFiles.length > 0) {
        try {
          setUploadingFiles(true);
          
          const uploadPromises = attachedFiles.map(async (file) => {
            try {
              const timestamp = Date.now();
              const randomId = Math.random().toString(36).substring(2, 15);
              const fileName = `certificate_${userProfile.id}_${timestamp}_${randomId}_${file.name}`;
              const filePath = `certificates/${userProfile.id}/${fileName}`;
              
              const storageRef = ref(storage, filePath);
              await uploadBytes(storageRef, file);
              const downloadURL = await getDownloadURL(storageRef);
              
              return {
                name: file.name,
                url: downloadURL,
                size: file.size,
                type: file.type,
              };
            } catch (fileError) {
              console.error(`파일 "${file.name}" 업로드 오류:`, fileError);
              throw fileError;
            }
          });

          attachments = await Promise.all(uploadPromises);
        } catch (uploadError) {
          console.error('파일 업로드 오류:', uploadError);
          const firebaseError = uploadError as { code?: string; message?: string };
          setError(`파일 업로드에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
          setSubmitting(false);
          setUploadingFiles(false);
          return;
        } finally {
          setUploadingFiles(false);
        }
      }

      // 제품 데이터 준비
      const productsData: CertificateProduct[] = [];
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        if (!product.productName.trim() && !product.productCode.trim() && !product.quantity.trim()) {
          continue; // 빈 제품은 제외
        }

        const productData: CertificateProduct = {
          productName: product.productName.trim(),
          productCode: product.productCode.trim() || undefined,
          quantity: product.quantity.trim() ? parseInt(product.quantity, 10) : undefined,
        };

        productsData.push(productData);
      }

      if (isEditMode && requestId) {
        // 수정 모드
        const certificateData: Record<string, unknown> = {
          customerName: formData.customerName.trim(),
          orderNumber: formData.orderNumber.trim() || null,
          products: productsData,
          certificateType: 'quality', // 기본값으로 품질 설정
          requestedCompletionDate: Timestamp.fromDate(new Date(formData.requestedCompletionDate)),
          updatedAt: Timestamp.now(),
        };

        // memo는 값이 있을 때만 추가
        if (formData.memo.trim()) {
          certificateData.memo = formData.memo.trim();
        }

        // 첨부 파일이 있으면 추가
        if (attachments.length > 0) {
          // 기존 첨부 파일과 병합
          const requestDoc = await getDoc(doc(db, 'certificates', requestId));
          const existingData = requestDoc.data();
          const existingAttachments = existingData?.attachments || [];
          certificateData.attachments = [...existingAttachments, ...attachments];
        }

        await updateDoc(doc(db, 'certificates', requestId), certificateData);
        setSuccess('성적서 요청이 성공적으로 수정되었습니다.');
        setSubmitting(false);
        
        // 수정 후 목록 페이지로 이동
        setTimeout(() => {
          router.push('/certificate/list');
        }, 2000);
        return;
      } else {
        // 등록 모드
        const certificateData: Record<string, unknown> = {
          userId: userProfile.id,
          userName: userProfile.name,
          userEmail: userProfile.email,
          userCompany: userProfile.company,
          customerName: formData.customerName.trim(),
          orderNumber: formData.orderNumber.trim() || null,
          products: productsData,
          certificateType: 'quality', // 기본값으로 품질 설정
          requestDate: Timestamp.now(),
          requestedCompletionDate: Timestamp.fromDate(new Date(formData.requestedCompletionDate)),
          status: 'pending',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: userProfile.id,
        };

        // memo는 값이 있을 때만 추가
        if (formData.memo.trim()) {
          certificateData.memo = formData.memo.trim();
        }

        // 첨부 파일이 있으면 추가
        if (attachments.length > 0) {
          certificateData.attachments = attachments;
        }

        await addDoc(collection(db, 'certificates'), certificateData);
        setSuccess('성적서 요청이 성공적으로 등록되었습니다.');
        setSubmitting(false);
        
        // 등록 후 목록 페이지로 이동
        setTimeout(() => {
          router.push('/certificate/list');
        }, 2000);
        return;
      }
    } catch (error) {
      console.error('성적서요청 등록 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`성적서요청 등록에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
      setSubmitting(false);
    }
  };

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

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {isEditMode ? '성적서요청 수정' : '성적서요청 등록'}
            </h1>
            <p className="text-gray-600">
              {isEditMode ? '성적서 요청 정보를 수정합니다.' : '신규 성적서 요청을 등록합니다.'}
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                id="customerName"
                name="customerName"
                type="text"
                label="고객명 *"
                required
                value={formData.customerName}
                onChange={handleChange}
                placeholder="고객명을 입력하세요"
                error={fieldErrors.customerName}
                style={{ textTransform: 'uppercase' }}
              />

              <Input
                id="orderNumber"
                name="orderNumber"
                type="text"
                label="발주번호"
                value={formData.orderNumber}
                onChange={handleChange}
                placeholder="발주번호를 입력하세요 (선택사항)"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            {/* 제품 정보 섹션 */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">
                  제품 정보
                </label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddProduct}
                  disabled={submitting || uploadingFiles}
                  className="text-sm"
                >
                  + 제품 추가
                </Button>
              </div>
              
              {fieldErrors.products && (
                <p className="text-sm text-red-600">{fieldErrors.products}</p>
              )}

              {products.map((product, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-700">제품 {index + 1}</h3>
                    {products.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveProduct(index)}
                        disabled={submitting || uploadingFiles}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        삭제
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Input
                      type="text"
                      label="제품명"
                      value={product.productName}
                      onChange={(e) => handleProductChange(index, 'productName', e.target.value)}
                      placeholder="제품명을 입력하세요"
                      style={{ textTransform: 'uppercase' }}
                      disabled={submitting || uploadingFiles}
                    />

                    <Input
                      type="text"
                      label="제품코드"
                      value={product.productCode}
                      onChange={(e) => handleProductChange(index, 'productCode', e.target.value)}
                      placeholder="제품코드를 입력하세요"
                      style={{ textTransform: 'uppercase' }}
                      disabled={submitting || uploadingFiles}
                    />

                    <Input
                      type="text"
                      inputMode="numeric"
                      label="수량"
                      value={product.quantity}
                      onChange={(e) => handleProductChange(index, 'quantity', e.target.value)}
                      placeholder="수량을 입력하세요"
                      pattern="[0-9]*"
                      disabled={submitting || uploadingFiles}
                    />
                  </div>
                </div>
              ))}
            </div>

            <Input
              id="requestedCompletionDate"
              name="requestedCompletionDate"
              type="date"
              label="완료요청일 *"
              required
              value={formData.requestedCompletionDate}
              onChange={handleChange}
              error={fieldErrors.requestedCompletionDate}
              min={today}
            />

            {/* 파일 첨부 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                파일 첨부 (최대 3개)
              </label>
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                disabled={attachedFiles.length >= 3 || uploadingFiles || submitting}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {attachedFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {attachedFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <svg
                          className="w-5 h-5 text-gray-400 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        <span className="text-sm text-gray-700 truncate">{file.name}</span>
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          ({formatFileSize(file.size)})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        disabled={uploadingFiles || submitting}
                        className="ml-2 text-red-600 hover:text-red-800 flex-shrink-0"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {attachedFiles.length >= 3 && (
                <p className="mt-2 text-xs text-gray-500">최대 3개까지 첨부할 수 있습니다.</p>
              )}
            </div>

            {/* 비고 */}
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
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                placeholder="추가 요청사항이나 비고를 입력하세요 (선택사항)"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={submitting || uploadingFiles}
              >
                취소
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={submitting || uploadingFiles}
                disabled={submitting || uploadingFiles}
              >
                {isEditMode ? '수정' : '등록'}
              </Button>
            </div>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function CertificateRequestPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">로딩 중...</p>
          </div>
        </div>
      </div>
    }>
      <CertificateRequestContent />
    </Suspense>
  );
}

