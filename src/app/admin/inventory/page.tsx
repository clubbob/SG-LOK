"use client";

export default function AdminInventoryPage() {
  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">재고관리</h1>
        <p className="text-gray-600 mt-2">재고 관련 메뉴를 확인하세요.</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-gray-600">
        좌측 메뉴에서 <span className="font-semibold text-gray-800">재고현황</span>을 선택해 주세요.
      </div>
    </div>
  );
}

