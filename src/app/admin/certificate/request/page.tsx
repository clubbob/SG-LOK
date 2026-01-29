"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, addDoc, Timestamp, doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { InquiryAttachment, CertificateAttachment, CertificateProduct } from '@/types';
import { getProductMappingByCode, addProductMapping, getAllProductMappings, updateProductMapping, deleteProductMapping } from '@/lib/productMappings';
import { ProductMapping } from '@/types';

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
  const [, setExistingCertificateFile] = useState<CertificateAttachment | null>(null);
  
  // 오늘 날짜를 YYYY-MM-DD 형식으로 변환
  const today = new Date().toISOString().split('T')[0];
  
  const [formData, setFormData] = useState({
    customerName: '',
    orderNumber: '',
    requestedCompletionDate: '',
    memo: '',
  });

  // 제품 배열 (제품명, 제품코드, 수량, 비고 셋트)
  const [products, setProducts] = useState<Array<{
    productName: string;
    productCode: string;
    quantity: string;
    remark: string;
    productNameCode?: string; // 제품명코드 (GMC, GME 등)
  }>>([{ productName: '', productCode: '', quantity: '', remark: '' }]);

  // 제품명코드 매핑 관련 상태
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [currentProductIndex, setCurrentProductIndex] = useState<number | null>(null);
  const [currentProductCode, setCurrentProductCode] = useState<string>('');
  const [allMappings, setAllMappings] = useState<ProductMapping[]>([]);
  const [showMappingList, setShowMappingList] = useState(false);
  const [mappingSearchQuery, setMappingSearchQuery] = useState('');
  const [editingMapping, setEditingMapping] = useState<ProductMapping | null>(null);

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
              remark: p.remark || '',
              productNameCode: p.productNameCode || '',
            })));
          } else if (data.productName || data.productCode || data.quantity) {
            // 기존 단일 제품 데이터를 배열로 변환
            setProducts([{
              productName: data.productName || '',
              productCode: data.productCode || '',
              quantity: data.quantity?.toString() || '',
              remark: '',
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
  const handleProductChange = (index: number, field: 'productName' | 'productCode' | 'quantity' | 'remark', value: string) => {
    setProducts(prev => {
      const newProducts = [...prev];
      if (field === 'quantity') {
        // 수량은 숫자만 허용
        newProducts[index] = { ...newProducts[index], [field]: value.replace(/[^0-9]/g, '') };
      } else if (field === 'remark') {
        // 비고는 영문을 대문자로 변환
        newProducts[index] = { ...newProducts[index], [field]: value.toUpperCase() };
      } else {
        // 제품명, 제품코드는 대문자로 변환
        newProducts[index] = { ...newProducts[index], [field]: value.toUpperCase() };
      }
      return newProducts;
    });
    
    // 해당 필드의 에러 초기화
    if (fieldErrors[`${field}-${index}`]) {
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[`${field}-${index}`];
        return newErrors;
      });
    }
  };

  // 제품명 입력란 포커스 아웃 핸들러 (매핑 조회 및 자동 변환)
  const handleProductNameBlur = async (index: number) => {
    const product = products[index];
    const productNameCode = product.productName.trim().toUpperCase();
    
    if (!productNameCode) return;
    
    try {
      // Firestore에서 매핑 조회
      const mapping = await getProductMappingByCode(productNameCode);
      
      if (mapping) {
        // 매핑이 있으면 자동 변환
        setProducts(prev => {
          const newProducts = [...prev];
          newProducts[index] = {
            ...newProducts[index],
            productName: mapping.productName,
            productNameCode: mapping.productCode,
            // 제품코드가 비어있으면 제품명코드 자동 입력
            productCode: newProducts[index].productCode || mapping.productCode,
          };
          return newProducts;
        });
      } else {
        // 매핑이 없으면 모달 표시
        setCurrentProductIndex(index);
        setCurrentProductCode(productNameCode);
        setShowMappingModal(true);
      }
    } catch (error) {
      console.error('제품명코드 매핑 조회 오류:', error);
    }
  };

  // 매핑 목록 로드
  useEffect(() => {
    const loadMappings = async () => {
      try {
        const mappings = await getAllProductMappings();
        setAllMappings(mappings);
      } catch (error) {
        console.error('매핑 목록 로드 오류:', error);
      }
    };
    loadMappings();
  }, []);

  // 매핑 추가 핸들러
  const handleAddMapping = async (productCode: string, productName: string) => {
    try {
      await addProductMapping(productCode, productName);
      
      // 매핑 목록 새로고침
      const mappings = await getAllProductMappings();
      setAllMappings(mappings);
      
      // 현재 제품에 적용
      if (currentProductIndex !== null) {
        setProducts(prev => {
          const newProducts = [...prev];
          newProducts[currentProductIndex] = {
            ...newProducts[currentProductIndex],
            productName: productName,
            productNameCode: productCode,
            productCode: productCode, // 제품명코드만 입력 (사용자가 직접 "-" 및 나머지 코드 입력)
          };
          return newProducts;
        });
      }
      
      setShowMappingModal(false);
      setCurrentProductIndex(null);
      setCurrentProductCode('');
    } catch (error: unknown) {
      console.error('매핑 추가 오류:', error);
      const message = error instanceof Error ? error.message : '매핑 추가에 실패했습니다.';
      alert(message);
    }
  };

  // 매핑 수정 핸들러
  const handleUpdateMapping = async (id: string, productName: string) => {
    try {
      await updateProductMapping(id, productName);
      
      // 매핑 목록 새로고침
      const mappings = await getAllProductMappings();
      setAllMappings(mappings);
      
      setEditingMapping(null);
    } catch (error) {
      console.error('매핑 수정 오류:', error);
      alert('매핑 수정에 실패했습니다.');
    }
  };

  // 매핑 삭제 핸들러
  const handleDeleteMapping = async (id: string) => {
    if (!confirm('이 매핑을 삭제하시겠습니까?')) return;
    
    try {
      await deleteProductMapping(id);
      
      // 매핑 목록 새로고침
      const mappings = await getAllProductMappings();
      setAllMappings(mappings);
    } catch (error) {
      console.error('매핑 삭제 오류:', error);
      alert('매핑 삭제에 실패했습니다.');
    }
  };

  // 제품 추가 (빈 입력란으로 새 행 추가)
  const handleAddProduct = () => {
    setProducts(prev => [
      ...prev,
      {
        productName: '',
        productCode: '',
        quantity: '',
        remark: '',
        productNameCode: '',
      },
    ]);
  };

  // 제품 삭제
  const handleRemoveProduct = (index: number) => {
    const productName = products[index]?.productName || `제품 ${index + 1}`;
    if (confirm(`"${productName}" 제품을 삭제하시겠습니까?`)) {
      // 제품이 1개만 있어도 삭제 가능하지만, 삭제 후 빈 제품 1개는 유지
      setProducts(prev => {
        const newProducts = prev.filter((_, i) => i !== index);
        // 제품이 모두 삭제되면 빈 제품 1개 추가
        return newProducts.length > 0 ? newProducts : [{ productName: '', productCode: '', quantity: '', remark: '' }];
      });
    }
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

    // 고객명 필수 (1순위)
    if (!formData.customerName.trim()) {
      errors.customerName = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      return false;
    }

    // 제품 정보 필수 검증 (2순위)
    if (!products || products.length === 0) {
      errors.products = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      return false;
    } else {
      // 각 제품의 필수 필드 검증
      let hasError = false;
      products.forEach((product, index) => {
        if (!product.productName?.trim()) {
          errors[`productName-${index}`] = '이 입력란을 작성하세요.';
          hasError = true;
        }
        if (!product.productCode?.trim()) {
          errors[`productCode-${index}`] = '이 입력란을 작성하세요.';
          hasError = true;
        }
        if (!product.quantity?.trim()) {
          errors[`quantity-${index}`] = '이 입력란을 작성하세요.';
          hasError = true;
        }
      });
      
      if (hasError) {
        setFieldErrors(errors);
        return false;
      }
    }

    // 완료요청일 필수 (3순위)
    if (!formData.requestedCompletionDate.trim()) {
      errors.requestedCompletionDate = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      return false;
    }

    setFieldErrors({});
    return true;
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

        // 제품명코드는 값이 있을 때만 추가
        if (product.productNameCode?.trim()) {
          productData.productNameCode = product.productNameCode.trim();
        }

        // 비고는 값이 있을 때만 추가
        if (product.remark?.trim()) {
          productData.remark = product.remark.trim();
        }

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
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-4">
                제품 정보 *
              </label>
              {fieldErrors.products && (
                <div className="absolute left-0 top-6 mt-1 px-2 py-1 bg-orange-100 border border-orange-300 rounded shadow-lg text-xs text-gray-800 whitespace-nowrap z-10">
                  <div className="flex items-center gap-1">
                    <svg className="w-4 h-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span>{fieldErrors.products}</span>
                  </div>
                </div>
              )}
            </div>

            {products.map((product, index) => (
              <div key={index} className="border-2 border-gray-300 rounded-lg p-5 space-y-4 bg-white shadow-sm mb-6">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">
                      {index + 1}
                    </span>
                    <h3 className="text-base font-semibold text-gray-900">제품 {index + 1}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveProduct(index)}
                    disabled={submitting || uploadingFiles}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    삭제
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[5fr_3fr_1.8fr_2.2fr] gap-4">
                  <div className="relative">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Input
                          type="text"
                          name="productName"
                          id={`productName-${index}`}
                          label="제품명 *"
                          required
                          value={product.productName}
                          onChange={(e) => handleProductChange(index, 'productName', e.target.value)}
                          onBlur={() => handleProductNameBlur(index)}
                          placeholder="제품명코드 입력 (예: GMC)"
                          style={{ textTransform: 'uppercase' }}
                          disabled={submitting || uploadingFiles}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentProductIndex(index);
                          setCurrentProductCode('');
                          setShowMappingModal(true);
                        }}
                        disabled={submitting || uploadingFiles}
                        className="mb-0.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="제품명코드 매핑 추가"
                      >
                        +
                      </button>
                    </div>
                    {fieldErrors[`productName-${index}`] && (
                      <div className="absolute left-0 top-full mt-1 px-2 py-1 bg-orange-100 border border-orange-300 rounded shadow-lg text-xs text-gray-800 whitespace-nowrap z-10">
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span>{fieldErrors[`productName-${index}`]}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <Input
                      type="text"
                      name="productCode"
                      id={`productCode-${index}`}
                      label="제품코드 *"
                      required
                      value={product.productCode}
                      onChange={(e) => handleProductChange(index, 'productCode', e.target.value.toUpperCase())}
                      placeholder={product.productNameCode ? `${product.productNameCode}-04-04N 또는 ${product.productNameCode} 04-04N 형식으로 입력` : "제품코드를 입력하세요"}
                      style={{ textTransform: 'uppercase' }}
                      disabled={submitting || uploadingFiles}
                    />
                    {fieldErrors[`productCode-${index}`] && (
                      <div className="absolute left-0 top-full mt-1 px-2 py-1 bg-orange-100 border border-orange-300 rounded shadow-lg text-xs text-gray-800 whitespace-nowrap z-10">
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span>{fieldErrors[`productCode-${index}`]}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <Input
                      type="text"
                      inputMode="numeric"
                      label="수량 *"
                      required
                      value={product.quantity}
                      onChange={(e) => handleProductChange(index, 'quantity', e.target.value)}
                      placeholder="수량 입력"
                      pattern="[0-9]*"
                      disabled={submitting || uploadingFiles}
                    />
                    {fieldErrors[`quantity-${index}`] && (
                      <div className="absolute left-0 top-full mt-1 px-2 py-1 bg-orange-100 border border-orange-300 rounded shadow-lg text-xs text-gray-800 whitespace-nowrap z-10">
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span>{fieldErrors[`quantity-${index}`]}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                      <Input
                        type="text"
                        label="비고"
                        value={product.remark}
                        onChange={(e) => handleProductChange(index, 'remark', e.target.value)}
                        placeholder="비고 입력"
                        style={{ textTransform: 'uppercase' }}
                        disabled={submitting || uploadingFiles}
                      />
                    </div>
                </div>
              </div>
            ))}

            {/* 제품 추가 버튼 */}
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="primary"
                onClick={handleAddProduct}
                disabled={submitting || uploadingFiles}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold shadow-md hover:shadow-lg transition-shadow"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                제품 추가
              </Button>
            </div>
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
              placeholder="비고 입력"
              disabled={isEditMode}
            />
          </div>


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

        {/* 제품명코드 매핑 모달 */}
        {showMappingModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  {currentProductCode ? `제품명코드 "${currentProductCode}" 매핑 추가` : '제품명코드 매핑 관리'}
                </h2>
                <button
                  onClick={() => {
                    setShowMappingModal(false);
                    setCurrentProductIndex(null);
                    setCurrentProductCode('');
                    setEditingMapping(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                  type="button"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {editingMapping ? (
                // 수정 모드
                <EditMappingForm
                  mapping={editingMapping}
                  onSave={(productName) => {
                    if (editingMapping.id) {
                      handleUpdateMapping(editingMapping.id, productName);
                    }
                  }}
                  onCancel={() => setEditingMapping(null)}
                />
              ) : (
                // 추가 모드
                <AddMappingForm
                  initialProductCode={currentProductCode}
                  onSave={(productCode, productName) => {
                    handleAddMapping(productCode, productName);
                  }}
                  onCancel={() => {
                    setShowMappingModal(false);
                    setCurrentProductIndex(null);
                    setCurrentProductCode('');
                  }}
                />
              )}

              {/* 매핑 목록 */}
              <div className="mt-6 border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">등록된 매핑 목록</h3>
                  <button
                    onClick={() => setShowMappingList(!showMappingList)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    {showMappingList ? '접기' : '펼치기'}
                  </button>
                </div>
                {showMappingList && (
                  <>
                    <div className="mb-3">
                      <input
                        type="text"
                        value={mappingSearchQuery}
                        onChange={(e) => setMappingSearchQuery(e.target.value)}
                        placeholder="제품코드 또는 제품명으로 검색"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {(() => {
                      const q = mappingSearchQuery.trim().toLowerCase();
                      const filtered = q
                        ? allMappings.filter(
                            (m) =>
                              m.productCode.toLowerCase().includes(q) ||
                              m.productName.toLowerCase().includes(q)
                          )
                        : allMappings;
                      return (
                        <>
                          {allMappings.length > 0 && (
                            <p className="text-xs text-gray-500 mb-2">
                              {q
                                ? `검색 결과 ${filtered.length}개 / 총 ${allMappings.length}개`
                                : `총 ${allMappings.length}개`}
                              {filtered.length > 5 && ' · 아래 목록 스크롤 가능'}
                            </p>
                          )}
                          <div
                            className="space-y-2 min-h-[6rem] max-h-72 overflow-y-auto overscroll-y-contain rounded border border-gray-200 bg-gray-50/50 px-2 py-2"
                          >
                            {filtered.length === 0 ? (
                              <p className="text-sm text-gray-500 text-center py-4">
                                {allMappings.length === 0 ? '등록된 매핑이 없습니다.' : '검색 결과가 없습니다.'}
                              </p>
                            ) : (
                          filtered.map((mapping) => (
                            <div
                              key={mapping.id}
                              className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100"
                            >
                              <div className="flex-1">
                                <span className="text-sm font-medium text-gray-900">{mapping.productCode}</span>
                                <span className="text-sm text-gray-500 mx-2">→</span>
                                <span className="text-sm text-gray-700">{mapping.productName}</span>
                              </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setEditingMapping(mapping)}
                              className="text-blue-600 hover:text-blue-800 text-sm"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => mapping.id && handleDeleteMapping(mapping.id)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      ))
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 매핑 추가 폼 컴포넌트
function AddMappingForm({
  initialProductCode,
  onSave,
  onCancel,
}: {
  initialProductCode: string;
  onSave: (productCode: string, productName: string) => void;
  onCancel: () => void;
}) {
  const [productCode, setProductCode] = useState(initialProductCode);
  const [productName, setProductName] = useState('');

  // 모달이 열릴 때 이미 입력된 제품명코드(GMC 등)가 있으면 해당 필드에 반영
  useEffect(() => {
    setProductCode(initialProductCode);
  }, [initialProductCode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productCode.trim() || !productName.trim()) {
      alert('제품명코드와 제품명을 모두 입력해주세요.');
      return;
    }
    onSave(productCode.trim().toUpperCase(), productName.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          제품명코드 *
        </label>
        <Input
          type="text"
          value={productCode}
          onChange={(e) => setProductCode(e.target.value.toUpperCase())}
          placeholder="예: GMC"
          required
          style={{ textTransform: 'uppercase' }}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          제품명 *
        </label>
        <Input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value.toUpperCase())}
          placeholder="예: MALE CONNECTOR"
          required
          style={{ textTransform: 'uppercase' }}
        />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" variant="primary">
          저장
        </Button>
      </div>
    </form>
  );
}

// 매핑 수정 폼 컴포넌트
function EditMappingForm({
  mapping,
  onSave,
  onCancel,
}: {
  mapping: ProductMapping;
  onSave: (productName: string) => void;
  onCancel: () => void;
}) {
  const [productName, setProductName] = useState(mapping.productName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) {
      alert('제품명을 입력해주세요.');
      return;
    }
    onSave(productName.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          제품명코드
        </label>
        <Input
          type="text"
          value={mapping.productCode}
          disabled
          className="bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          제품명 *
        </label>
        <Input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value.toUpperCase())}
          placeholder="예: MALE CONNECTOR"
          required
          style={{ textTransform: 'uppercase' }}
        />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" variant="primary">
          저장
        </Button>
      </div>
    </form>
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

