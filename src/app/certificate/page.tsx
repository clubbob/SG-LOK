"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';

export default function CertificatePage() {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  // 인증 확인 및 리다이렉트
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

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

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            성적서관리
          </h1>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <Link href="/certificate/request">
              <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-100 rounded-lg p-3">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">성적서요청 등록</h2>
                    <p className="text-sm text-gray-600">신규 성적서 요청을 등록합니다</p>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/certificate/list">
              <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-100 rounded-lg p-3">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">성적서 목록</h2>
                    <p className="text-sm text-gray-600">요청한 성적서를 확인합니다</p>
                  </div>
                </div>
              </div>
            </Link>
          </div>

          {/* 안내 섹션 */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-lg p-8 mt-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-3">성적서관리 시스템</h2>
              <p className="text-lg text-gray-700 max-w-3xl mx-auto">
                제품의 품질, 안전, 환경 관련 성적서를 체계적으로 관리하고 요청할 수 있습니다.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* 카드 1 */}
              <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition-all duration-300 border-l-4 border-blue-500">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="bg-blue-100 rounded-xl p-4">
                      <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold">
                        1
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">간편한 성적서 요청</h3>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      제품 정보를 입력하고 성적서 유형을 선택하여 간편하게 성적서를 요청할 수 있습니다.
                    </p>
                  </div>
                </div>
              </div>

              {/* 카드 2 */}
              <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition-all duration-300 border-l-4 border-green-500">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="bg-green-100 rounded-xl p-4">
                      <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold">
                        2
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">실시간 상태 확인</h3>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      요청한 성적서의 진행 상태를 실시간으로 확인하고, 완료된 성적서를 바로 다운로드할 수 있습니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 bg-white rounded-lg p-6 border-t-2 border-blue-200">
              <div className="flex items-start gap-3">
                <svg className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-gray-700 leading-relaxed">
                  <span className="font-semibold text-gray-900">안내:</span> 성적서 요청 시 제품명, 제품코드, 로트번호 등 필요한 정보를 정확히 입력해주시기 바랍니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

