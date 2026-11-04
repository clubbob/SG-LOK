"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';

export default function ProductionPage() {
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4 sm:mb-6">
            생산관리
          </h1>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <Link href="/production/request">
              <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-100 rounded-lg p-3">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">생산요청 등록</h2>
                    <p className="text-sm text-gray-600">신규 생산요청을 등록합니다</p>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/production/list">
              <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-100 rounded-lg p-3">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">생산요청 현황</h2>
                    <p className="text-sm text-gray-600">등록한 생산요청 현황을 확인합니다</p>
                  </div>
                </div>
              </div>
            </Link>
          </div>

          {/* 생산관리 시스템 소개 */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-lg p-8 mt-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-3">생산관리 시스템</h2>
              <p className="text-lg text-gray-700 max-w-3xl mx-auto">
                생산요청 등록 · 진행 · 현황 공유를 한곳에서 처리합니다.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition-all duration-300 border-l-4 border-blue-500">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="bg-blue-100 rounded-xl p-4">
                      <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold shrink-0">
                        1
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">요청·승인</h3>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      다품목 등록, 관리자 승인, 생산계획·완료예정일 반영.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition-all duration-300 border-l-4 border-green-500">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="bg-green-100 rounded-xl p-4">
                      <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                        />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold shrink-0">
                        2
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">생산 진행</h3>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      1·2·3차, UHP 세정/EP, 생산완료 수량과 생산 이슈 관리.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition-all duration-300 border-l-4 border-indigo-500">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="bg-indigo-100 rounded-xl p-4">
                      <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-500 text-white text-xs font-bold shrink-0">
                        3
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">현황·공유</h3>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      현황 목록 조회, 엑셀(CSV) 저장. 관리자 진행 PDF 출력.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

