"use client";

import { Header, Footer } from '@/components/layout';

export default function InventoryPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8">
            <h1 className="text-2xl font-bold text-gray-900">재고관리</h1>
            <p className="mt-2 text-gray-600">재고관리 메뉴 페이지입니다.</p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

