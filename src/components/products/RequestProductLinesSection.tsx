'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ProductMapping } from '@/types';
import {
  addProductMapping,
  deleteProductMapping,
  getAllProductMappings,
  getProductMappingByCode,
  updateProductMapping,
} from '@/lib/productMappings';
import type { RequestProductLine } from '@/lib/products/requestProductLines';
import {
  createEmptyRequestProductLine,
  PRODUCT_CODE_NO_SPACE_MESSAGE,
  PRODUCTION_PRODUCT_GROUP_OPTIONS,
  productCodeHasWhitespace,
} from '@/lib/products/requestProductLines';

const productLineSelectClass =
  'flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-50';

function productLineGridClass(
  showProductGroup: boolean,
  showOrderQuantity: boolean,
  showRequestedCompletionDate: boolean
): string {
  if (showProductGroup) {
    if (showOrderQuantity && showRequestedCompletionDate) {
      return 'md:grid-cols-[2fr_5fr_3fr_1.6fr_1.8fr_2fr]';
    }
    if (showOrderQuantity) {
      return 'md:grid-cols-[2fr_5fr_3fr_1.6fr_1.8fr]';
    }
    if (showRequestedCompletionDate) {
      return 'md:grid-cols-[2fr_5fr_3fr_1.8fr_2fr]';
    }
    return 'md:grid-cols-[2fr_5fr_3fr_1.8fr]';
  }
  if (showOrderQuantity && showRequestedCompletionDate) {
    return 'md:grid-cols-[5fr_3fr_1.8fr_2fr_2.2fr]';
  }
  if (showOrderQuantity) {
    return 'md:grid-cols-[5fr_3fr_1.8fr_2fr]';
  }
  if (showRequestedCompletionDate) {
    return 'md:grid-cols-[5fr_3fr_2fr_2.2fr]';
  }
  return 'md:grid-cols-[5fr_3fr_2fr]';
}

type RequestProductLinesSectionProps = {
  products: RequestProductLine[];
  onProductsChange: (products: RequestProductLine[]) => void;
  fieldErrors: Record<string, string>;
  onClearFieldError: (key: string) => void;
  onSetFieldError: (key: string, message: string) => void;
  disabled?: boolean;
  /** 생산요청: 제품명 앞 제품군 선택 */
  showProductGroup?: boolean;
  /** 생산요청: 제품별 생산목적·국내/해외·고객사명 */
  showProductionContext?: boolean;
  /** 생산요청: 고객사명 자동완성 목록 */
  customerNameSuggestions?: string[];
  /** 생산요청: 제품별 완료요청일 */
  showRequestedCompletionDate?: boolean;
  /** 신규 등록 시 완료요청일 min (YYYY-MM-DD) */
  requestedCompletionDateMin?: string;
  /** false: 목록에서 한 제품 줄만 수정 (추가·삭제 숨김) */
  allowMultipleProducts?: boolean;
};

export function RequestProductLinesSection({
  products,
  onProductsChange,
  fieldErrors,
  onClearFieldError,
  onSetFieldError,
  disabled = false,
  showProductGroup = false,
  showProductionContext = false,
  customerNameSuggestions = [],
  showRequestedCompletionDate = false,
  requestedCompletionDateMin,
  allowMultipleProducts = true,
}: RequestProductLinesSectionProps) {
  const [activeCustomerSuggestionIndex, setActiveCustomerSuggestionIndex] = useState<number | null>(
    null
  );
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [currentProductIndex, setCurrentProductIndex] = useState<number | null>(null);
  const [currentProductCode, setCurrentProductCode] = useState('');
  const [allMappings, setAllMappings] = useState<ProductMapping[]>([]);
  const [showMappingList, setShowMappingList] = useState(false);
  const [mappingSearchQuery, setMappingSearchQuery] = useState('');
  const [editingMapping, setEditingMapping] = useState<ProductMapping | null>(null);

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

  const handleProductChange = (
    index: number,
    field:
      | 'productionReason'
      | 'salesRegion'
      | 'customerName'
      | 'productGroup'
      | 'productName'
      | 'productCode'
      | 'orderQuantity'
      | 'quantity'
      | 'requestedCompletionDate'
      | 'remark',
    value: string
  ) => {
    const newProducts = [...products];
    if (field === 'quantity' || field === 'orderQuantity') {
      newProducts[index] = { ...newProducts[index], [field]: value.replace(/[^0-9]/g, '') };
    } else {
      newProducts[index] = { ...newProducts[index], [field]: value };
    }
    if (field === 'productionReason' && value === 'inventory') {
      newProducts[index] = { ...newProducts[index], customerName: '' };
      onClearFieldError(`customerName-${index}`);
    }
    onProductsChange(newProducts);

    if (field === 'productCode') {
      const errorKey = `productCode-${index}`;
      if (productCodeHasWhitespace(value)) {
        onSetFieldError(errorKey, PRODUCT_CODE_NO_SPACE_MESSAGE);
      } else if (fieldErrors[errorKey] === PRODUCT_CODE_NO_SPACE_MESSAGE) {
        onClearFieldError(errorKey);
      }
    } else {
      onClearFieldError(`${field}-${index}`);
    }
    if (fieldErrors.products) onClearFieldError('products');
  };

  const handleAddProduct = () => {
    onProductsChange([...products, createEmptyRequestProductLine()]);
  };

  const handleRemoveProduct = (index: number) => {
    const productName = products[index]?.productName || `제품 ${index + 1}`;
    if (!confirm(`"${productName}" 제품을 삭제하시겠습니까?`)) return;
    const newProducts = products.filter((_, i) => i !== index);
    onProductsChange(newProducts.length > 0 ? newProducts : [createEmptyRequestProductLine()]);
  };

  const handleProductNameBlur = async (index: number) => {
    const product = products[index];
    const productNameCode = product.productName.trim().toUpperCase();
    if (!productNameCode) return;
    try {
      const mapping = await getProductMappingByCode(productNameCode);
      if (mapping) {
        const newProducts = [...products];
        newProducts[index] = {
          ...newProducts[index],
          productName: mapping.productName,
          productNameCode: mapping.productCode,
          productCode: newProducts[index].productCode || mapping.productCode,
        };
        onProductsChange(newProducts);
      } else {
        setCurrentProductIndex(index);
        setCurrentProductCode(productNameCode);
        setShowMappingModal(true);
      }
    } catch (error) {
      console.error('제품명코드 매핑 조회 오류:', error);
    }
  };

  const handleAddMapping = async (productCode: string, productName: string) => {
    try {
      await addProductMapping(productCode, productName);
      const mappings = await getAllProductMappings();
      setAllMappings(mappings);
      if (currentProductIndex !== null) {
        const newProducts = [...products];
        newProducts[currentProductIndex] = {
          ...newProducts[currentProductIndex],
          productName,
          productNameCode: productCode,
          productCode: productCode,
        };
        onProductsChange(newProducts);
      }
      setShowMappingModal(false);
      setCurrentProductIndex(null);
      setCurrentProductCode('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '매핑 추가에 실패했습니다.';
      alert(message);
    }
  };

  const handleUpdateMapping = async (id: string, productName: string) => {
    try {
      await updateProductMapping(id, productName);
      const mappings = await getAllProductMappings();
      setAllMappings(mappings);
      setEditingMapping(null);
    } catch {
      alert('매핑 수정에 실패했습니다.');
    }
  };

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('이 매핑을 삭제하시겠습니까?')) return;
    try {
      await deleteProductMapping(id);
      const mappings = await getAllProductMappings();
      setAllMappings(mappings);
    } catch {
      alert('매핑 삭제에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-4">제품 정보 *</label>
          {fieldErrors.products && (
            <div className="absolute left-0 top-6 mt-1 px-2 py-1 bg-orange-100 border border-orange-300 rounded shadow-lg text-xs text-gray-800 whitespace-nowrap z-10">
              <div className="flex items-center gap-1">
                <svg className="w-4 h-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
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
              {allowMultipleProducts && (
                <button
                  type="button"
                  onClick={() => handleRemoveProduct(index)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  삭제
                </button>
              )}
            </div>

            {showProductionContext && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">생산목적 *</label>
                  <select
                    value={product.productionReason}
                    onChange={(e) =>
                      handleProductChange(index, 'productionReason', e.target.value)
                    }
                    disabled={disabled}
                    required
                    className={`${productLineSelectClass} ${
                      fieldErrors[`productionReason-${index}`] ? 'border-red-500' : ''
                    }`}
                  >
                    <option value="">선택</option>
                    <option value="order">주문</option>
                    <option value="inventory">재고</option>
                  </select>
                  {fieldErrors[`productionReason-${index}`] && (
                    <p className="mt-1 text-xs text-red-600">
                      {fieldErrors[`productionReason-${index}`]}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">국내/해외 *</label>
                  <select
                    value={product.salesRegion}
                    onChange={(e) => handleProductChange(index, 'salesRegion', e.target.value)}
                    disabled={disabled}
                    required
                    className={`${productLineSelectClass} ${
                      fieldErrors[`salesRegion-${index}`] ? 'border-red-500' : ''
                    }`}
                  >
                    <option value="">선택</option>
                    <option value="domestic">국내</option>
                    <option value="overseas">해외</option>
                  </select>
                  {fieldErrors[`salesRegion-${index}`] && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors[`salesRegion-${index}`]}</p>
                  )}
                </div>
                {product.productionReason === 'order' && (
                  <div className="relative">
                    <Input
                      type="text"
                      label="고객사명 *"
                      value={product.customerName}
                      onChange={(e) => handleProductChange(index, 'customerName', e.target.value)}
                      onFocus={() => {
                        if (product.customerName.length > 0) {
                          setActiveCustomerSuggestionIndex(index);
                        }
                      }}
                      onBlur={() => setTimeout(() => setActiveCustomerSuggestionIndex(null), 200)}
                      placeholder="고객사명 입력"
                      disabled={disabled}
                      required
                      error={fieldErrors[`customerName-${index}`]}
                      list={`customerNameList-${index}`}
                    />
                    <datalist id={`customerNameList-${index}`}>
                      {customerNameSuggestions.map((name, suggestionIdx) => (
                        <option key={suggestionIdx} value={name} />
                      ))}
                    </datalist>
                    {activeCustomerSuggestionIndex === index &&
                      product.customerName.length > 0 &&
                      customerNameSuggestions.filter((name) =>
                        name.toLowerCase().includes(product.customerName.toLowerCase())
                      ).length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                          {customerNameSuggestions
                            .filter((name) =>
                              name.toLowerCase().includes(product.customerName.toLowerCase())
                            )
                            .slice(0, 10)
                            .map((name, suggestionIdx) => (
                              <button
                                key={suggestionIdx}
                                type="button"
                                onClick={() => {
                                  handleProductChange(index, 'customerName', name);
                                  setActiveCustomerSuggestionIndex(null);
                                }}
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
            )}

            <div
              className={`grid grid-cols-1 gap-4 ${productLineGridClass(
                showProductGroup,
                showProductionContext && product.productionReason === 'order',
                showRequestedCompletionDate
              )}`}
            >
              {showProductGroup && (
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">제품군 *</label>
                  <select
                    value={product.productGroup}
                    onChange={(e) => handleProductChange(index, 'productGroup', e.target.value)}
                    disabled={disabled}
                    required
                    className={productLineSelectClass}
                  >
                    <option value="">선택</option>
                    {PRODUCTION_PRODUCT_GROUP_OPTIONS.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                  {fieldErrors[`productGroup-${index}`] && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors[`productGroup-${index}`]}</p>
                  )}
                </div>
              )}

              <div className="relative">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      type="text"
                      label="제품명 *"
                      required
                      value={product.productName}
                      onChange={(e) => handleProductChange(index, 'productName', e.target.value)}
                      onBlur={() => handleProductNameBlur(index)}
                      placeholder="제품명코드 입력 (예: GMC)"
                      style={{ textTransform: 'uppercase' }}
                      disabled={disabled}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentProductIndex(index);
                      setCurrentProductCode('');
                      setShowMappingModal(true);
                    }}
                    disabled={disabled}
                    className="mb-0.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="제품명코드 매핑 추가"
                  >
                    +
                  </button>
                </div>
                {fieldErrors[`productName-${index}`] && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors[`productName-${index}`]}</p>
                )}
              </div>

              <div className="relative">
                <Input
                  type="text"
                  label="제품코드 *"
                  required
                  value={product.productCode}
                  onChange={(e) => handleProductChange(index, 'productCode', e.target.value)}
                  onBlur={(e) => handleProductChange(index, 'productCode', e.target.value.toUpperCase())}
                  placeholder={
                    product.productNameCode
                      ? `${product.productNameCode}-04-04N 또는 ${product.productNameCode} 04-04N 형식으로 입력`
                      : '제품코드 입력'
                  }
                  style={{ textTransform: 'uppercase' }}
                  disabled={disabled}
                />
                {fieldErrors[`productCode-${index}`] && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors[`productCode-${index}`]}</p>
                )}
              </div>

              {showProductionContext && product.productionReason === 'order' && (
                <div className="relative">
                  <Input
                    type="text"
                    inputMode="numeric"
                    label="수주수량 *"
                    required
                    value={product.orderQuantity}
                    onChange={(e) => handleProductChange(index, 'orderQuantity', e.target.value)}
                    placeholder="수량 입력"
                    pattern="[0-9]*"
                    disabled={disabled}
                  />
                  {fieldErrors[`orderQuantity-${index}`] && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors[`orderQuantity-${index}`]}</p>
                  )}
                </div>
              )}

              <div className="relative">
                <Input
                  type="text"
                  inputMode="numeric"
                  label="생산요청수량 *"
                  required
                  value={product.quantity}
                  onChange={(e) => handleProductChange(index, 'quantity', e.target.value)}
                  placeholder="수량 입력"
                  pattern="[0-9]*"
                  disabled={disabled}
                />
                {fieldErrors[`quantity-${index}`] && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors[`quantity-${index}`]}</p>
                )}
              </div>

              {showRequestedCompletionDate && (
                <div className="relative">
                  <Input
                    type="date"
                    label="완료요청일 *"
                    required
                    value={product.requestedCompletionDate}
                    onChange={(e) =>
                      handleProductChange(index, 'requestedCompletionDate', e.target.value)
                    }
                    min={requestedCompletionDateMin}
                    disabled={disabled}
                    error={fieldErrors[`requestedCompletionDate-${index}`]}
                  />
                </div>
              )}
            </div>
          </div>
        ))}

        {allowMultipleProducts && (
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              variant="primary"
              onClick={handleAddProduct}
              disabled={disabled}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold shadow-md hover:shadow-lg transition-shadow"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              제품 추가
            </Button>
          </div>
        )}
      </div>

      {showMappingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">
                {currentProductCode ? `제품명코드 "${currentProductCode}" 매핑 추가` : '제품명코드 매핑 관리'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowMappingModal(false);
                  setCurrentProductIndex(null);
                  setCurrentProductCode('');
                  setEditingMapping(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {editingMapping ? (
              <EditMappingForm
                mapping={editingMapping}
                onSave={(productName) => {
                  if (editingMapping.id) handleUpdateMapping(editingMapping.id, productName);
                }}
                onCancel={() => setEditingMapping(null)}
              />
            ) : (
              <AddMappingForm
                initialProductCode={currentProductCode}
                onSave={handleAddMapping}
                onCancel={() => {
                  setShowMappingModal(false);
                  setCurrentProductIndex(null);
                  setCurrentProductCode('');
                }}
              />
            )}

            <div className="mt-6 border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">등록된 매핑 목록</h3>
                <button
                  type="button"
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
                      onChange={(e) => setMappingSearchQuery(e.target.value.toUpperCase())}
                      placeholder="제품코드 또는 제품명으로 검색"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>
                  {(() => {
                    const q = mappingSearchQuery.trim().toLowerCase();
                    const filtered = q
                      ? allMappings.filter(
                          (m) =>
                            m.productCode.toLowerCase().includes(q) || m.productName.toLowerCase().includes(q)
                        )
                      : allMappings;
                    return (
                      <div className="space-y-2 min-h-[6rem] max-h-72 overflow-y-auto overscroll-y-contain rounded border border-gray-200 bg-gray-50/50 px-2 py-2">
                        {filtered.length === 0 ? (
                          <p className="text-sm text-gray-500 text-center py-4">
                            {allMappings.length === 0 ? '등록된 매핑이 없습니다.' : '검색 결과가 없습니다.'}
                          </p>
                        ) : (
                          filtered.map((mapping) => (
                            <div
                              key={mapping.id}
                              className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 flex-nowrap"
                            >
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-900 whitespace-nowrap">
                                  {mapping.productCode}
                                </span>
                                <span className="text-sm text-gray-500 mx-2">→</span>
                                <span className="text-sm text-gray-700 whitespace-nowrap">{mapping.productName}</span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingMapping(mapping)}
                                  className="text-blue-600 hover:text-blue-800 text-sm"
                                >
                                  수정
                                </button>
                                <button
                                  type="button"
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
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
  const productCodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProductCode(initialProductCode);
  }, [initialProductCode]);

  const handleSave = () => {
    if (!productCode.trim() || !productName.trim()) {
      alert('제품명코드와 제품명을 모두 입력해주세요.');
      return;
    }
    onSave(productCode.trim().toUpperCase(), productName.trim());
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">제품명코드 *</label>
        <Input
          ref={productCodeInputRef}
          type="text"
          value={productCode}
          onChange={(e) => setProductCode(e.target.value)}
          onBlur={(e) => setProductCode(e.target.value.toUpperCase())}
          placeholder="예: GMC"
          required
          style={{ textTransform: 'uppercase' }}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">제품명 *</label>
        <Input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          onBlur={(e) => setProductName(e.target.value.toUpperCase())}
          placeholder="예: MALE CONNECTOR"
          required
          style={{ textTransform: 'uppercase' }}
        />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>취소</Button>
        <Button type="button" variant="primary" onClick={handleSave}>저장</Button>
      </div>
    </div>
  );
}

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

  const handleSave = () => {
    if (!productName.trim()) {
      alert('제품명을 입력해주세요.');
      return;
    }
    onSave(productName.trim());
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">제품명코드</label>
        <Input type="text" value={mapping.productCode} disabled className="bg-gray-100" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">제품명 *</label>
        <Input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          onBlur={(e) => setProductName(e.target.value.toUpperCase())}
          placeholder="예: MALE CONNECTOR"
          required
          style={{ textTransform: 'uppercase' }}
        />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>취소</Button>
        <Button type="button" variant="primary" onClick={handleSave}>저장</Button>
      </div>
    </div>
  );
}
