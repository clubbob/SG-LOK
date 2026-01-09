"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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

// 소재 종류 타입
type MaterialType = 'Hexa' | 'Round';

// 소재/사이즈 데이터 타입
interface MaterialSize {
  id: string;
  materialType: MaterialType;
  size: string;
}

// 제품별 소재 사이즈 데이터 타입
interface ProductMaterialSize {
  id: string;
  productName: string;
  productCode: string;
  materials: MaterialSize[];
  createdAt?: Date;
  updatedAt?: Date;
}

export default function InspectionCertiPage() {
  const router = useRouter();
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // 제품별 소재 사이즈 목록 (임시 데이터 - 나중에 Firestore에서 가져올 예정)
  const [productMaterialSizes, setProductMaterialSizes] = useState<ProductMaterialSize[]>([]);
  
  // 새 제품 추가 모드
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    productName: '',
    productCode: '',
    materialType: 'Hexa' as MaterialType,
    size: '',
  });
  
  // 제품 수정 모드
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState({
    productName: '',
    productCode: '',
    materialType: 'Hexa' as MaterialType,
    size: '',
  });

  // 필드 에러 상태
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  
  // 검색 상태
  const [searchTerm, setSearchTerm] = useState('');
  
  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Firestore에서 데이터 로드
  const loadProductMaterialSizes = async () => {
    try {
      const q = query(
        collection(db, 'productMaterialSizes'),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const products: ProductMaterialSize[] = [];
      
      querySnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        products.push({
          id: docSnapshot.id,
          productName: data.productName || '',
          productCode: data.productCode || '',
          materials: (data.materials || []).map((m: { id?: string; materialType: string; size: string }) => ({
            id: m.id || Date.now().toString(),
            materialType: m.materialType as MaterialType,
            size: m.size || '',
          })),
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt instanceof Date ? data.createdAt : new Date()),
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt instanceof Date ? data.updatedAt : new Date()),
        });
      });
      
      // createdAt이 없는 경우를 대비해 클라이언트 측에서도 정렬 (createdAt 기준 내림차순)
      products.sort((a, b) => {
        const aTime = a.createdAt?.getTime() || (a.updatedAt?.getTime() || 0);
        const bTime = b.createdAt?.getTime() || (b.updatedAt?.getTime() || 0);
        return bTime - aTime;
      });
      
      setProductMaterialSizes(products);
    } catch (error) {
      console.error('제품별 소재 사이즈 로드 오류:', error);
      alert('데이터를 불러오는 중 오류가 발생했습니다.');
    }
  };

  // 검색어 변경 시 첫 페이지로 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    // 관리자 세션 확인
    const isAdmin = checkAdminAuth();
    setIsAdminAuthenticated(isAdmin);
    setLoading(false);
    
    if (!isAdmin) {
      router.push('/admin/login');
      return;
    }
    
    // Firestore에서 데이터 가져오기
    loadProductMaterialSizes();
  }, [router]);

  // 폼 검증 함수
  const validateForm = () => {
    const errors: Record<string, string> = {};

    // 제품명 필수 (1순위)
    if (!newProduct.productName.trim()) {
      errors.productName = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      return false;
    }

    // 제품코드 필수 (2순위)
    if (!newProduct.productCode.trim()) {
      errors.productCode = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      return false;
    }

    // 소재 사이즈 필수 (3순위)
    if (!newProduct.size.trim()) {
      errors.size = '이 입력란을 작성하세요.';
      setFieldErrors(errors);
      return false;
    }

    // 사이즈 숫자 검증
    const sizeValue = parseFloat(newProduct.size);
    if (isNaN(sizeValue)) {
      errors.size = '사이즈는 숫자로 입력해주세요.';
      setFieldErrors(errors);
      return false;
    }

    setFieldErrors({});
    return true;
  };

  // 새 제품 추가 핸들러
  const handleAddProduct = async () => {
    if (!validateForm()) {
      // HTML5 validation 트리거
      const productNameInput = document.getElementById('new-product-name') as HTMLInputElement;
      const productCodeInput = document.getElementById('new-product-code') as HTMLInputElement;
      const sizeInput = document.getElementById('new-product-size') as HTMLInputElement;
      
      if (productNameInput && !newProduct.productName.trim()) {
        productNameInput.reportValidity();
        return;
      }
      if (productCodeInput && !newProduct.productCode.trim()) {
        productCodeInput.reportValidity();
        return;
      }
      if (sizeInput && !newProduct.size.trim()) {
        sizeInput.reportValidity();
        return;
      }
      return;
    }
    
    try {
      const productName = newProduct.productName.trim().toUpperCase();
      const productCode = newProduct.productCode.trim().toUpperCase();
      
      // 기존 제품 확인 (제품명+제품코드 조합)
      const existingProduct = productMaterialSizes.find(
        p => p.productName === productName && p.productCode === productCode
      );
      
      // 소재/사이즈 추가 (필수)
      const materials: MaterialSize[] = [{
        id: Date.now().toString(),
        materialType: newProduct.materialType,
        size: parseFloat(newProduct.size).toFixed(2),
      }];
      
      if (existingProduct) {
        // 기존 제품이 있으면 소재/사이즈만 추가
        const updatedMaterials = [...existingProduct.materials, ...materials];
        await updateDoc(doc(db, 'productMaterialSizes', existingProduct.id), {
          materials: updatedMaterials.map(m => ({
            id: m.id,
            materialType: m.materialType,
            size: m.size,
          })),
          updatedAt: Timestamp.now(),
        });
        await loadProductMaterialSizes();
      } else {
        // 새 제품 추가
        await addDoc(collection(db, 'productMaterialSizes'), {
          productName: productName,
          productCode: productCode,
          materials: materials.map(m => ({
            id: m.id,
            materialType: m.materialType,
            size: m.size,
          })),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        await loadProductMaterialSizes();
      }
      
      setNewProduct({ productName: '', productCode: '', materialType: 'Hexa', size: '' });
      setIsAddingProduct(false);
    } catch (error) {
      console.error('제품 추가 오류:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const firebaseError = error as { code?: string; message?: string };
      const detailedMessage = firebaseError.code 
        ? `제품 추가 중 오류가 발생했습니다.\n\n오류 코드: ${firebaseError.code}\n오류 메시지: ${firebaseError.message || errorMessage}`
        : `제품 추가 중 오류가 발생했습니다.\n\n오류 메시지: ${errorMessage}`;
      alert(detailedMessage);
    }
  };

  // 제품 삭제 핸들러
  const handleDeleteProduct = async (productId: string) => {
    const product = productMaterialSizes.find(p => p.id === productId);
    if (product && confirm(`"${product.productName} - ${product.productCode}" 제품을 삭제하시겠습니까?`)) {
      try {
        await deleteDoc(doc(db, 'productMaterialSizes', productId));
        await loadProductMaterialSizes();
      } catch (error) {
        console.error('제품 삭제 오류:', error);
        alert('제품 삭제 중 오류가 발생했습니다.');
      }
    }
  };


  // 제품 수정 시작 핸들러
  const handleStartEdit = (productId: string) => {
    const product = productMaterialSizes.find(p => p.id === productId);
    if (product) {
      setEditingProductId(productId);
      // 기존 소재/사이즈가 있으면 첫 번째 것을 기본값으로 설정
      const firstMaterial = product.materials.length > 0 ? product.materials[0] : null;
      setEditingProduct({
        productName: product.productName,
        productCode: product.productCode,
        materialType: firstMaterial ? firstMaterial.materialType : 'Hexa',
        size: firstMaterial ? firstMaterial.size : '',
      });
      setIsAddingProduct(false); // 추가 모드 종료
    }
  };

  // 제품 수정 취소 핸들러
  const handleCancelEdit = () => {
    setEditingProductId(null);
    setEditingProduct({
      productName: '',
      productCode: '',
      materialType: 'Hexa',
      size: '',
    });
  };

  // 제품 수정 저장 핸들러
  const handleSaveEdit = async () => {
    if (!editingProduct.productName.trim() || !editingProduct.productCode.trim()) {
      alert('제품명과 제품코드를 입력해주세요.');
      return;
    }
    
    if (editingProduct.size.trim()) {
      const sizeValue = parseFloat(editingProduct.size);
      if (isNaN(sizeValue)) {
        alert('사이즈는 숫자로 입력해주세요.');
        return;
      }
    }
    
    if (!editingProductId) return;
    
    try {
      const productName = editingProduct.productName.trim().toUpperCase();
      const productCode = editingProduct.productCode.trim().toUpperCase();
      const product = productMaterialSizes.find(p => p.id === editingProductId);
      
      if (!product) {
        alert('제품을 찾을 수 없습니다.');
        return;
      }
      
      const materials: MaterialSize[] = [...product.materials];
      
      // 사이즈가 입력된 경우 첫 번째 소재/사이즈를 업데이트 (수정 모드)
      if (editingProduct.size.trim()) {
        const updatedMaterial: MaterialSize = {
          id: materials.length > 0 ? materials[0].id : Date.now().toString(),
          materialType: editingProduct.materialType,
          size: parseFloat(editingProduct.size).toFixed(2),
        };
        
        // 첫 번째 항목이 있으면 업데이트, 없으면 추가
        if (materials.length > 0) {
          materials[0] = updatedMaterial;
        } else {
          materials.push(updatedMaterial);
        }
      }
      
      await updateDoc(doc(db, 'productMaterialSizes', editingProductId), {
        productName: productName,
        productCode: productCode,
        materials: materials.map(m => ({
          id: m.id,
          materialType: m.materialType,
          size: m.size,
        })),
        updatedAt: Timestamp.now(),
      });
      
      await loadProductMaterialSizes();
      handleCancelEdit();
    } catch (error) {
      console.error('제품 수정 오류:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const firebaseError = error as { code?: string; message?: string };
      const detailedMessage = firebaseError.code 
        ? `제품 수정 중 오류가 발생했습니다.\n\n오류 코드: ${firebaseError.code}\n오류 메시지: ${firebaseError.message || errorMessage}`
        : `제품 수정 중 오류가 발생했습니다.\n\n오류 메시지: ${errorMessage}`;
      alert(detailedMessage);
    }
  };

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

  if (!isAdminAuthenticated) {
    return null;
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">제품별 소재 사이즈 관리</h1>
          <p className="text-gray-600">제품별 소재와 사이즈를 관리할 수 있습니다.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => setIsAddingProduct(true)}
          className="inline-flex items-center gap-2 px-6 py-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          제품 추가
        </Button>
      </div>

      {/* 제품 수정 폼 */}
      {editingProductId && (() => {
        const currentProduct = productMaterialSizes.find(p => p.id === editingProductId);
        if (!currentProduct) return null;
        
        return (
          <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">제품 수정</h3>
            
            {/* 기존 소재/사이즈 목록 */}
            {currentProduct.materials.length > 0 && (
              <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-2">기존 소재/사이즈</h4>
                <div className="flex flex-wrap gap-2">
                  {currentProduct.materials.map((material) => (
                    <span
                      key={material.id}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-700 rounded-md text-sm font-medium"
                    >
                      {material.materialType} / {material.size}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-7 gap-4 items-end">
              <div className="col-span-2">
                <Input
                  type="text"
                  label="제품명 *"
                  value={editingProduct.productName}
                  onChange={(e) => setEditingProduct({ ...editingProduct, productName: e.target.value.toUpperCase() })}
                  placeholder="제품명을 입력하세요"
                />
              </div>
              <div className="col-span-2">
                <Input
                  type="text"
                  label="제품코드 *"
                  value={editingProduct.productCode}
                  onChange={(e) => setEditingProduct({ ...editingProduct, productCode: e.target.value.toUpperCase() })}
                  placeholder="제품코드를 입력하세요"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  소재 종류
                </label>
                <select
                  value={editingProduct.materialType}
                  onChange={(e) => setEditingProduct({ ...editingProduct, materialType: e.target.value as MaterialType })}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  <option value="Hexa">Hexa</option>
                  <option value="Round">Round</option>
                </select>
              </div>
              <div>
                <Input
                  type="number"
                  step="0.01"
                  label="소재 사이즈 (mm)"
                  value={editingProduct.size}
                  onChange={(e) => setEditingProduct({ ...editingProduct, size: e.target.value })}
                  placeholder="사이즈"
                />
              </div>
              <div className="flex gap-3 whitespace-nowrap">
                <Button
                  variant="primary"
                  onClick={handleSaveEdit}
                  className="px-6 py-2 whitespace-nowrap"
                >
                  저장
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancelEdit}
                  className="px-6 py-2 whitespace-nowrap"
                >
                  취소
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 새 제품 추가 폼 */}
      {isAddingProduct && !editingProductId && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">새 제품 추가</h3>
          <div className="grid grid-cols-7 gap-4 items-end">
            <div className="col-span-2">
              <Input
                type="text"
                id="new-product-name"
                label="제품명 *"
                value={newProduct.productName}
                onChange={(e) => {
                  setNewProduct({ ...newProduct, productName: e.target.value.toUpperCase() });
                  if (fieldErrors.productName) {
                    setFieldErrors(prev => {
                      const newErrors = { ...prev };
                      delete newErrors.productName;
                      return newErrors;
                    });
                  }
                }}
                placeholder="제품명을 입력하세요"
                required
              />
            </div>
            <div className="col-span-2">
              <Input
                type="text"
                id="new-product-code"
                label="제품코드 *"
                value={newProduct.productCode}
                onChange={(e) => {
                  setNewProduct({ ...newProduct, productCode: e.target.value.toUpperCase() });
                  if (fieldErrors.productCode) {
                    setFieldErrors(prev => {
                      const newErrors = { ...prev };
                      delete newErrors.productCode;
                      return newErrors;
                    });
                  }
                }}
                placeholder="제품코드를 입력하세요"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                소재 종류 *
              </label>
              <select
                value={newProduct.materialType}
                onChange={(e) => setNewProduct({ ...newProduct, materialType: e.target.value as MaterialType })}
                className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                required
              >
                <option value="Hexa">Hexa</option>
                <option value="Round">Round</option>
              </select>
            </div>
            <div>
              <Input
                type="number"
                step="0.01"
                id="new-product-size"
                label="소재 사이즈 (mm) *"
                value={newProduct.size}
                onChange={(e) => {
                  setNewProduct({ ...newProduct, size: e.target.value });
                  if (fieldErrors.size) {
                    setFieldErrors(prev => {
                      const newErrors = { ...prev };
                      delete newErrors.size;
                      return newErrors;
                    });
                  }
                }}
                placeholder="사이즈"
                required
              />
            </div>
            <div className="flex gap-3 whitespace-nowrap">
              <Button
                variant="primary"
                onClick={handleAddProduct}
                className="px-6 py-2 whitespace-nowrap"
              >
                추가
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsAddingProduct(false);
                  setNewProduct({ productName: '', productCode: '', materialType: 'Hexa', size: '' });
                }}
                className="px-6 py-2 whitespace-nowrap"
              >
                취소
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 검색 영역 */}
      <div className="mb-4">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg
              className="h-5 w-5 text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1); // 검색 시 첫 페이지로 리셋
            }}
            placeholder="제품명, 제품코드 검색..."
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
            >
              <svg
                className="h-5 w-5 text-gray-400 hover:text-gray-600"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 제품별 소재 사이즈 목록 테이블 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  No.
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  등록/수정일
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  제품명
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  제품코드
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  소재 종류
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  소재 사이즈 (mm)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(() => {
                // 검색 필터링
                const filteredProducts = productMaterialSizes.filter(product => {
                  if (!searchTerm.trim()) return true;
                  const search = searchTerm.trim().toUpperCase();
                  return (
                    product.productName.toUpperCase().includes(search) ||
                    product.productCode.toUpperCase().includes(search)
                  );
                });
                
                // 페이지네이션 계산
                const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
                const startIndex = (currentPage - 1) * itemsPerPage;
                const endIndex = startIndex + itemsPerPage;
                const paginatedProducts = filteredProducts.slice(startIndex, endIndex);
                
                if (filteredProducts.length === 0) {
                  return (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        {searchTerm.trim() 
                          ? '검색 결과가 없습니다.' 
                          : '등록된 제품이 없습니다. &quot;제품 추가&quot; 버튼을 클릭하여 제품을 추가하세요.'}
                      </td>
                    </tr>
                  );
                }
                
                return (
                  <>
                    {paginatedProducts.map((product, index) => {
                  // 등록일/수정일 포맷팅 (수정일이 있으면 수정일, 없으면 등록일)
                  const displayDate = product.updatedAt && product.updatedAt.getTime() !== product.createdAt?.getTime() 
                    ? product.updatedAt 
                    : (product.createdAt || new Date());
                  const dateStr = displayDate.toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  });
                  
                  return (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="px-6 py-2 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{startIndex + index + 1}</div>
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{dateStr}</div>
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{product.productName}</div>
                      </td>
                    <td className="px-6 py-2 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{product.productCode}</div>
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap">
                      {product.materials.length === 0 ? (
                        <span className="text-sm text-gray-400">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-center">
                          {Array.from(new Set(product.materials.map(m => m.materialType))).map((materialType, index) => (
                            <span
                              key={index}
                              className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 rounded-md text-sm font-medium"
                            >
                              {materialType}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap">
                      {product.materials.length === 0 ? (
                        <span className="text-sm text-gray-400">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-center">
                          {Array.from(new Set(product.materials.map(m => m.size))).map((size, index) => (
                            <span
                              key={index}
                              className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 rounded-md text-sm font-medium"
                            >
                              {size}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-left text-sm font-medium">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleStartEdit(product.id)}
                          className="px-4 py-2 text-blue-600 hover:text-blue-900 border border-blue-300 rounded-md hover:bg-blue-50"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          className="px-4 py-2 text-red-600 hover:text-red-900 border border-red-300 rounded-md hover:bg-red-50"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                    })}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
        
        {/* 페이지네이션 */}
        {(() => {
          const filteredProducts = productMaterialSizes.filter(product => {
            if (!searchTerm.trim()) return true;
            const search = searchTerm.trim().toUpperCase();
            return (
              product.productName.toUpperCase().includes(search) ||
              product.productCode.toUpperCase().includes(search)
            );
          });
          const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
          
          if (totalPages <= 1) return null;
          
          return (
            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
              <div className="flex-1 flex justify-between sm:hidden">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  이전
                </button>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  다음
                </button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    총 <span className="font-medium">{filteredProducts.length}</span>개 중{' '}
                    <span className="font-medium">
                      {Math.min((currentPage - 1) * itemsPerPage + 1, filteredProducts.length)}
                    </span>
                    -
                    <span className="font-medium">
                      {Math.min(currentPage * itemsPerPage, filteredProducts.length)}
                    </span>
                    개 표시
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      이전
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                      if (
                        page === 1 ||
                        page === totalPages ||
                        (page >= currentPage - 2 && page <= currentPage + 2)
                      ) {
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                              currentPage === page
                                ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                                : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                            }`}
                          >
                            {page}
                          </button>
                        );
                      } else if (page === currentPage - 3 || page === currentPage + 3) {
                        return (
                          <span
                            key={page}
                            className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700"
                          >
                            ...
                          </span>
                        );
                      }
                      return null;
                    })}
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      다음
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
