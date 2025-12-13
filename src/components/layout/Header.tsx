"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';

export default function Header() {
  const { userProfile, isAuthenticated, signOut } = useAuth();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // 로그인/회원가입 페이지에서는 메뉴를 완전히 숨김
  const isAuthPage = pathname === '/login' || pathname === '/signup';

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('로그아웃 오류:', error);
    }
  };

  return (
    <header className="bg-blue-500 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* 로고 및 브랜드 */}
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Link href="/" className="hover:opacity-80 transition-opacity">
                <h1 className="text-2xl font-bold text-white cursor-pointer">
                  SG-LOK
                </h1>
              </Link>
            </div>
          </div>

          {/* 데스크톱 네비게이션 */}
          {!isAuthPage && (
            <nav className="hidden md:flex items-center space-x-4">
              <Link
                href="/production"
                className="px-4 py-2 rounded-md text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                생산관리
              </Link>
              {isAuthenticated && (
                <Link
                  href="/dashboard"
                  className="px-4 py-2 rounded-md text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  대시보드
                </Link>
              )}
            </nav>
          )}

          {/* 우측 메뉴 */}
          <div className="flex items-center space-x-4">
            {isAuthenticated ? (
              <>
                <span className="hidden md:block text-white text-sm">
                  {userProfile?.name || userProfile?.email}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  className="bg-white text-blue-600 hover:bg-gray-100"
                >
                  로그아웃
                </Button>
              </>
            ) : (
              !isAuthPage && (
                <>
                  <Link href="/login">
                    <Button variant="ghost" size="sm" className="text-white hover:bg-blue-700">
                      로그인
                    </Button>
                  </Link>
                  <Link href="/signup">
                    <Button variant="outline" size="sm" className="bg-white text-blue-600 hover:bg-gray-100">
                      회원가입
                    </Button>
                  </Link>
                </>
              )
            )}
            
            {/* 모바일 메뉴 버튼 */}
            {!isAuthPage && (
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="md:hidden text-white p-2"
                aria-label="메뉴"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {isMobileMenuOpen ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  )}
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 모바일 메뉴 */}
        {isMobileMenuOpen && !isAuthPage && (
          <div className="md:hidden pb-4">
            <nav className="flex flex-col space-y-2">
              <Link
                href="/production"
                className="px-4 py-2 rounded-md text-sm font-medium text-white hover:bg-blue-700"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                생산관리
              </Link>
              {isAuthenticated && (
                <Link
                  href="/dashboard"
                  className="px-4 py-2 rounded-md text-sm font-medium text-white hover:bg-blue-700"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  대시보드
                </Link>
              )}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}

