"use client";

export default function AdminSubstituteMainPage() {
  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Code Find 메인</h1>
        <p className="text-gray-600 mt-2">Code Find 관련 기능을 이어서 구성할 수 있습니다.</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-gray-600">
        좌측 메뉴에서 <span className="font-semibold text-gray-800">Code Find</span>를 선택해 세부 화면으로 이동할 수 있습니다.
      </div>
    </div>
  );
}
