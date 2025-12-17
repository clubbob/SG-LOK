"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            생산관리
          </h1>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
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
                    <h2 className="text-lg font-semibold text-gray-900">생산요청 목록</h2>
                    <p className="text-sm text-gray-600">등록한 생산요청을 확인합니다</p>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/production/calendar">
              <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-100 rounded-lg p-3">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">생산일정 캘린더</h2>
                    <p className="text-sm text-gray-600">생산 일정을 간트 차트 형식으로 확인합니다</p>
                  </div>
                </div>
              </div>
            </Link>
          </div>

          {/* 장점 섹션 */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-lg p-8 mt-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-3">생산관리 시스템의 장점</h2>
              <p className="text-lg text-gray-700 max-w-3xl mx-auto">
                SG-LOK Work Flow는 작은 조직도 큰 회사처럼 움직일 수 있도록, 생산 업무를 하나의 흐름으로
                묶어주는 도구입니다.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* 카드 1 */}
              <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition-all duration-300 border-l-4 border-blue-500">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="bg-blue-100 rounded-xl p-4">
                      <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold">
                        1
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">요청부터 완료까지 한 번에 관리</h3>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      카톡·엑셀에 흩어져 있던 생산요청을 한 곳에서 등록·승인·완료까지 연결해 관리합니다.
                      누락되거나 중복되는 일을 줄여줍니다.
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
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold">
                        2
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">간트 차트로 한눈에 보는 생산일정</h3>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      라인별 일정, 검토 대기·계획 확정·생산완료 상태를 캘린더에서 한 번에 볼 수 있어,
                      병목 구간과 여유 구간을 쉽게 파악할 수 있습니다.
                    </p>
                  </div>
                </div>
              </div>

              {/* 카드 3 */}
              <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition-all duration-300 border-l-4 border-purple-500">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="bg-purple-100 rounded-xl p-4">
                      <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-500 text-white text-xs font-bold">
                        3
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">팀 간 커뮤니케이션 비용 감소</h3>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      영업·생산·관리자가 같은 화면을 보면서 이야기할 수 있어, 추가 문의나 확인 전화 없이도
                      현재 상태를 바로 공유할 수 있습니다.
                    </p>
                  </div>
                </div>
              </div>

              {/* 카드 4 */}
              <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition-all duration-300 border-l-4 border-orange-500">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="bg-orange-100 rounded-xl p-4">
                      <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold">
                        4
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">데이터 기반 의사결정</h3>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      생산이력과 납기 이행 여부가 자동으로 기록되기 때문에, 어느 고객·어떤 제품이
                      실제로 수익과 부담을 주는지 데이터로 판단할 수 있습니다.
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
                  <span className="font-semibold text-gray-900">팁:</span> 지금 사용하는 방식(엑셀·카톡·구두 지시)을 SG-LOK Work Flow로 점차 대체 활용하면 정보가 자동으로 정리되고,
                  반복적인 확인 업무가 크게 줄어듭니다.
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

