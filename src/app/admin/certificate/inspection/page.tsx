"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, Timestamp } from 'firebase/firestore';
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

  // Firestore에서 데이터 로드
  const loadProductMaterialSizes = async () => {
    try {
      const q = query(collection(db, 'productMaterialSizes'));
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
        });
      });
      
      setProductMaterialSizes(products);
    } catch (error) {
      console.error('제품별 소재 사이즈 로드 오류:', error);
      alert('데이터를 불러오는 중 오류가 발생했습니다.');
    }
  };

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

      {/* 제품별 소재 사이즈 목록 테이블 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
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
              {productMaterialSizes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    등록된 제품이 없습니다. &quot;제품 추가&quot; 버튼을 클릭하여 제품을 추가하세요.
                  </td>
                </tr>
              ) : (
                productMaterialSizes.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{product.productName}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{product.productCode}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
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
                    <td className="px-6 py-4 whitespace-nowrap">
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
                    <td className="px-6 py-4 whitespace-nowrap text-left text-sm font-medium">
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
