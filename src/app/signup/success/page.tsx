"use client";

import React from 'react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui';
import Link from 'next/link';

export default function SignupSuccessPage() {
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
                SG-LOK Work Flow 에 오신 것을 환영합니다.
              </p>
              <p className="text-sm text-gray-500">
                회사 시스템의 특성상 관리자가 회원가입 정보를 확인한 후 승인을 완료해야 로그인하실 수 있습니다.
                승인 완료 시까지는 로그인 시도 시에도 접속이 제한될 수 있습니다.
              </p>
            </div>
          </div>
          <div className="flex justify-center">
            <Link href="/">
              <Button variant="primary" size="lg">
                메인페이지로 이동
              </Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

