"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui';
import Link from 'next/link';

export default function SignupSuccessPage() {
  const router = useRouter();
  const { isAuthenticated, userProfile, loading } = useAuth();

  useEffect(() => {
    // 5초 후에도 로그인되지 않으면 홈으로 리다이렉트
    const timer = setTimeout(() => {
      if (!isAuthenticated && !loading) {
        router.push('/');
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [isAuthenticated, loading, router]);

  // 로딩 중이거나 인증되지 않은 경우에도 기본 메시지 표시
  if (loading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 bg-gray-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
              <div className="text-center">
                <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
                  <svg
                    className="h-8 w-8 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  회원가입이 완료되었습니다!
                </h1>
                <p className="text-lg text-gray-600 mb-6">
                  SG-LOK에 오신 것을 환영합니다.
                </p>
                <p className="text-sm text-gray-500">
                  사용자 정보를 불러오는 중...
                </p>
              </div>
            </div>
            <div className="flex justify-center">
              <Link href="/">
                <Button variant="primary" size="lg">
                  홈으로 이동
                </Button>
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* 성공 메시지 */}
          <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                회원가입이 완료되었습니다!
              </h1>
              <p className="text-lg text-gray-600 mb-6">
                {userProfile?.name}님, SG-LOK에 오신 것을 환영합니다.
              </p>
            </div>
          </div>

          {/* 사용자 정보 카드 */}
          <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              회원 정보
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600">이름</span>
                <span className="font-medium text-gray-900">{userProfile?.name || '-'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600">이메일</span>
                <span className="font-medium text-gray-900">{userProfile?.email || '-'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600">회사명</span>
                <span className="font-medium text-gray-900">{userProfile?.company || '-'}</span>
              </div>
              {userProfile?.businessNumber && (
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-gray-600">사업자 등록번호</span>
                  <span className="font-medium text-gray-900">
                    {userProfile.businessNumber.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3')}
                  </span>
                </div>
              )}
              {userProfile?.phone && (
                <div className="flex justify-between items-center py-2">
                  <span className="text-gray-600">핸드폰 번호</span>
                  <span className="font-medium text-gray-900">{userProfile.phone}</span>
                </div>
              )}
            </div>
          </div>

          {/* 안내 메시지 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">
              다음 단계
            </h3>
            <ul className="space-y-2 text-blue-800">
              <li className="flex items-start">
                <svg className="w-5 h-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>회원가입이 완료되었습니다. 이제 모든 서비스를 이용하실 수 있습니다.</span>
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>생산관리 메뉴를 통해 서비스를 시작하세요.</span>
              </li>
            </ul>
          </div>

          {/* 액션 버튼 */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/production">
              <Button variant="primary" size="lg" className="w-full sm:w-auto">
                생산관리 시작하기
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="outline" size="lg" className="w-full sm:w-auto">
                대시보드로 이동
              </Button>
            </Link>
            <Link href="/">
              <Button variant="ghost" size="lg" className="w-full sm:w-auto">
                홈으로 이동
              </Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

