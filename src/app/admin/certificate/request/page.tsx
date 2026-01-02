"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, addDoc, Timestamp, doc, getDoc, updateDoc, getDocs, query, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { CertificateType, InquiryAttachment, CertificateAttachment, CertificateProduct } from '@/types';

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

function AdminCertificateRequestContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get('id');
  const [isEditMode, setIsEditMode] = useState(false);
  const [loadingRequest, setLoadingRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<InquiryAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [uploadingCertificateFile, setUploadingCertificateFile] = useState(false);
  const [existingCertificateFile, setExistingCertificateFile] = useState<CertificateAttachment | null>(null);
  
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
  const [certificateStatus, setCertificateStatus] = useState<'pending' | 'in_progress' | 'completed' | 'cancelled' | null>(null);

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
        const requestDoc = await getDoc(doc(db, 'certificates', requestId));
        if (requestDoc.exists()) {
          const data = requestDoc.data();
          
          setIsEditMode(true);
          setCertificateStatus(data.status || 'pending');
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
          // 기존 첨부 파일 로드
          if (data.attachments && Array.isArray(data.attachments) && data.attachments.length > 0) {
            setExistingAttachments(data.attachments.map((att) => {
              const attachment = att as InquiryAttachment & { 
                uploadedAt?: Date | { toDate: () => Date }; 
                uploadedBy?: string;
              };
              let uploadedAtDate: Date;
              if (attachment.uploadedAt) {
                if (attachment.uploadedAt instanceof Date) {
                  uploadedAtDate = attachment.uploadedAt;
                } else if (typeof attachment.uploadedAt === 'object' && 'toDate' in attachment.uploadedAt && typeof attachment.uploadedAt.toDate === 'function') {
                  uploadedAtDate = attachment.uploadedAt.toDate();
                } else {
                  uploadedAtDate = new Date();
                }
              } else {
                uploadedAtDate = new Date();
              }
              
              return {
                name: attachment.name,
                url: attachment.url,
                size: attachment.size,
                type: attachment.type,
                uploadedAt: uploadedAtDate,
                uploadedBy: attachment.uploadedBy || '',
              };
            }));
          }
          
          // 기존 성적서 파일 정보 로드
          if (data.certificateFile) {
            setExistingCertificateFile({
              name: data.certificateFile.name,
              url: data.certificateFile.url,
              size: data.certificateFile.size,
              type: data.certificateFile.type,
              uploadedAt: data.certificateFile.uploadedAt?.toDate() || new Date(),
              uploadedBy: data.certificateFile.uploadedBy || 'admin',
            });
          }
        } else {
          setError('성적서 요청을 찾을 수 없습니다.');
          router.push('/admin/certificate');
        }
      } catch (error) {
        console.error('성적서 요청 로드 오류:', error);
        setError('성적서 요청을 불러오는데 실패했습니다.');
      } finally {
        setLoadingRequest(false);
      }
    };

    if (requestId) {
      loadRequestData();
    }
  }, [requestId, router]);


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
    // 제품이 1개만 있어도 삭제 가능하지만, 삭제 후 빈 제품 1개는 유지
    setProducts(prev => {
      const newProducts = prev.filter((_, i) => i !== index);
      // 제품이 모두 삭제되면 빈 제품 1개 추가
      return newProducts.length > 0 ? newProducts : [{ productName: '', productCode: '', quantity: '' }];
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      // 최대 3개 파일 제한 (기존 첨부 파일 포함)
      if ((existingAttachments.length + attachedFiles.length + files.length) > 3) {
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

  const removeExistingAttachment = (index: number) => {
    setExistingAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleCertificateFileUpload = async () => {
    if (!requestId || !certificateFile) {
      setError('성적서 파일을 선택해주세요.');
      return;
    }

    setUploadingCertificateFile(true);
    setError('');
    setSuccess('');

    try {
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 15);
      const fileName = `certificate_${requestId}_${timestamp}_${randomId}_${certificateFile.name}`;
      const filePath = `certificates/${requestId}/${fileName}`;
      
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, certificateFile);
      const downloadURL = await getDownloadURL(storageRef);
      
      const certificateAttachment: CertificateAttachment = {
        name: certificateFile.name,
        url: downloadURL,
        size: certificateFile.size,
        type: certificateFile.type,
        uploadedAt: new Date(),
        uploadedBy: 'admin',
      };

      await updateDoc(doc(db, 'certificates', requestId), {
        certificateFile: certificateAttachment,
        status: 'completed',
        completedAt: Timestamp.now(),
        completedBy: 'admin',
        updatedAt: Timestamp.now(),
        updatedBy: 'admin',
      });

      setSuccess('성적서 파일이 성공적으로 업로드되었습니다.');
      setCertificateFile(null);
      setExistingCertificateFile(certificateAttachment);
      setCertificateStatus('completed');
    } catch (error) {
      console.error('파일 업로드 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      setError(`파일 업로드에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
    } finally {
      setUploadingCertificateFile(false);
    }
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
              const fileName = `certificate_admin_${timestamp}_${randomId}_${file.name}`;
              const filePath = `certificates/admin/${fileName}`;
              
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
          updatedBy: 'admin',
        };

        // memo는 값이 있을 때만 추가
        if (formData.memo.trim()) {
          certificateData.memo = formData.memo.trim();
        }

        // 첨부 파일 처리 (기존 첨부 파일 + 새로 업로드한 파일)
        const allAttachments = [...existingAttachments, ...attachments];
        if (allAttachments.length > 0) {
          certificateData.attachments = allAttachments;
        }

        await updateDoc(doc(db, 'certificates', requestId), certificateData);
        setSubmitting(false);
        setSuccess('성적서 요청이 성공적으로 수정되었습니다.');
        
        // 수정 후 목록 페이지로 이동
        setTimeout(() => {
          router.push('/admin/certificate');
        }, 2000);
        return;
      } else {
        // 등록 모드
        const certificateData: Record<string, unknown> = {
          userId: 'admin',
          userName: '관리자',
          userEmail: 'admin@sglok.com',
          customerName: formData.customerName.trim(),
          orderNumber: formData.orderNumber.trim() || null,
          products: productsData,
          certificateType: 'quality', // 기본값으로 품질 설정
          requestDate: Timestamp.now(),
          requestedCompletionDate: Timestamp.fromDate(new Date(formData.requestedCompletionDate)),
          status: 'pending',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: 'admin',
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
        setSubmitting(false);
        setSuccess('성적서 요청이 성공적으로 등록되었습니다.');
        
        // 등록 후 목록 페이지로 이동
        setTimeout(() => {
          router.push('/admin/certificate');
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

  if (loadingRequest) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
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
              disabled={isEditMode}
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
                  <button
                    type="button"
                    onClick={() => handleRemoveProduct(index)}
                    disabled={submitting || uploadingFiles}
                    className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    삭제
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Input
                    type="text"
                    name="productName"
                    id={`productName-${index}`}
                    label="제품명"
                    value={product.productName}
                    onChange={(e) => handleProductChange(index, 'productName', e.target.value)}
                    placeholder="제품명을 입력하세요"
                    style={{ textTransform: 'uppercase' }}
                    disabled={submitting || uploadingFiles}
                  />

                  <Input
                    type="text"
                    name="productCode"
                    id={`productCode-${index}`}
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
            disabled={isEditMode}
          />

          {/* 승인된 경우 완료예정일 수정 가능 */}
          {isEditMode && certificateStatus && (certificateStatus === 'in_progress' || certificateStatus === 'completed') && (
            <Input
              id="plannedCompletionDate"
              name="plannedCompletionDate"
              type="date"
              label="완료예정일 *"
              required
              value={formData.requestedCompletionDate}
              onChange={(e) => {
                setFormData({ ...formData, requestedCompletionDate: e.target.value });
                if (fieldErrors.requestedCompletionDate) {
                  setFieldErrors({ ...fieldErrors, requestedCompletionDate: '' });
                }
              }}
              error={fieldErrors.requestedCompletionDate}
              min={today}
            />
          )}

          {/* 파일 첨부 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              파일 첨부 (최대 3개)
            </label>
            {/* 기존 첨부 파일 표시 */}
            {existingAttachments.length > 0 && (
              <div className="mb-3 space-y-2">
                <p className="text-xs text-gray-600 mb-2">기존 첨부 파일:</p>
                {existingAttachments.map((file, index) => (
                  <div
                    key={`existing-${index}`}
                    className="flex items-center justify-between bg-blue-50 rounded-md px-3 py-2"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <svg
                        className="w-5 h-5 text-blue-600 flex-shrink-0"
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
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline truncate"
                      >
                        {file.name}
                      </a>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        ({file.size ? formatFileSize(file.size) : ''})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExistingAttachment(index)}
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
            <input
              type="file"
              multiple
              onChange={handleFileChange}
              disabled={(existingAttachments.length + attachedFiles.length) >= 3 || uploadingFiles || submitting}
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
            {(existingAttachments.length + attachedFiles.length) >= 3 && (
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
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="추가 요청사항이나 비고를 입력하세요 (선택사항)"
              disabled={isEditMode}
            />
          </div>

          {/* 성적서 파일 (수정 모드일 때만 표시) */}
          {isEditMode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                성적서 파일
              </label>
              {existingCertificateFile ? (
                <div className="mb-3 p-3 bg-gray-50 rounded-md border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-gray-900">{existingCertificateFile.name}</span>
                      {existingCertificateFile.size && (
                        <span className="text-xs text-gray-500">
                          ({(existingCertificateFile.size / 1024).toFixed(1)} KB)
                        </span>
                      )}
                    </div>
                    <a
                      href={existingCertificateFile.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium underline"
                    >
                      다운로드
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-2">업로드된 성적서 파일이 없습니다.</p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {existingCertificateFile ? '성적서 파일 변경' : '성적서 파일 업로드'}
                </label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setCertificateFile(file);
                    }
                  }}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={uploadingCertificateFile || submitting}
                />
                {certificateFile && (
                  <p className="mt-2 text-sm text-gray-600">선택된 파일: {certificateFile.name}</p>
                )}
                {certificateFile && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="mt-2"
                    onClick={handleCertificateFileUpload}
                    disabled={uploadingCertificateFile || submitting}
                    loading={uploadingCertificateFile}
                  >
                    {existingCertificateFile ? '파일 변경' : '파일 업로드'}
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/admin/certificate')}
              disabled={submitting || uploadingFiles || uploadingCertificateFile}
            >
              취소
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={submitting || uploadingFiles}
              disabled={submitting || uploadingFiles || uploadingCertificateFile}
            >
              {isEditMode ? '수정' : '등록'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminCertificateRequestPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </div>
    }>
      <AdminCertificateRequestContent />
    </Suspense>
  );
}

