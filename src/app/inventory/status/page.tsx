"use client";

import { useState } from 'react';
import { Header, Footer } from '@/components/layout';

export default function InventoryStatusPage() {
  const categories = [
    'Micro Weld Fittings',
    'Tube Butt Weld Fittings',
    'Metal Face Seal Fittings',
  ];
  const [activeCategory, setActiveCategory] = useState(categories[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const microWeldProducts = [
    {
      name: 'Micro Elbow (HME)',
      imageSrc: '/inventory/micro-elbow-hme.png',
      itemCodes: ['HME-02', 'HME-04', 'HME-06', 'HME-08', 'HME-12'],
    },
  ];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredMicroWeldProducts = microWeldProducts
    .map((product) => {
      const isProductNameMatched = product.name.toLowerCase().includes(normalizedQuery);
      const filteredCodes =
        normalizedQuery === '' || isProductNameMatched
          ? product.itemCodes
          : product.itemCodes.filter((itemCode) => itemCode.toLowerCase().includes(normalizedQuery));

      return {
        ...product,
        filteredCodes,
      };
    })
    .filter((product) => product.filteredCodes.length > 0);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">UHP 재고현황</h1>
            <p className="text-gray-600 mt-2">현재 UHP 재고 현황을 검색하는 페이지입니다.</p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="mb-4">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="제품명 검색..."
                  className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            <h2 className="text-lg font-semibold text-gray-900 mb-4">제품 카테고리</h2>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`rounded-md border px-4 py-2.5 text-base font-semibold transition-colors ${
                    activeCategory === category
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            {activeCategory === 'Micro Weld Fittings' && (
              <div className="mt-6 space-y-4">
                {filteredMicroWeldProducts.map((product) => (
                  <div key={product.name} className="rounded-lg border border-gray-200 bg-white p-5">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">{product.name}</h3>
                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
                      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                        <div className="h-[220px] w-full overflow-hidden rounded-md border border-gray-200 bg-white">
                          <img
                            src={product.imageSrc}
                            alt={product.name}
                            className="h-full w-full object-contain"
                          />
                        </div>
                      </div>

                      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {product.filteredCodes.map((itemCode) => (
                            <div
                              key={itemCode}
                              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3"
                            >
                              <p className="text-sm font-semibold text-gray-800">{itemCode}</p>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                                >
                                  현재고
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredMicroWeldProducts.length === 0 && (
                  <p className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-4 text-sm text-gray-500">
                    검색 결과가 없습니다.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
