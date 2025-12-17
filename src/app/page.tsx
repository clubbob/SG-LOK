"use client";

import React from 'react';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';

export default function Home() {
  const { isAuthenticated, loading } = useAuth(); // 페이지 마운트 시 한 번만 실행

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

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              SG-LOK Work Flow 에 오신 것을 환영합니다.
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              작지만 강한 회사를 만들기 위한 효율적인 웹 서비스 플랫폼
            </p>
            {!isAuthenticated && (
              <div className="flex justify-center gap-4">
                <Link href="/login">
                  <Button variant="primary" size="lg">
                    로그인
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button variant="outline" size="lg">
                    회원가입
                  </Button>
                </Link>
              </div>
            )}
            {isAuthenticated && (
              <Link href="/dashboard">
                <Button variant="primary" size="lg">
                  대시보드 바로가기
                </Button>
              </Link>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
