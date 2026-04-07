"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';

export default function Header() {
  const { user, userProfile, isAuthenticated, signOut, loading } = useAuth();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isProdMenuOpen, setIsProdMenuOpen] = useState(false);
  const [isCertMenuOpen, setIsCertMenuOpen] = useState(false);
  const [isInventoryMenuOpen, setIsInventoryMenuOpen] = useState(false);
  const [isDealerMenuOpen, setIsDealerMenuOpen] = useState(false);
  const [isSubstituteMenuOpen, setIsSubstituteMenuOpen] = useState(false);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsProdMenuOpen(false);
    setIsCertMenuOpen(false);
    setIsInventoryMenuOpen(false);
    setIsDealerMenuOpen(false);
    setIsSubstituteMenuOpen(false);
  }, [pathname]);
  
  // 로그인/회원가입 페이지에서는 메뉴를 완전히 숨김
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  
  // pathname이 null일 경우를 대비한 안전한 체크 함수
  const isActivePath = (path: string) => {
    if (!pathname) return false;
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setIsUserMenuOpen(false);
    } catch (error) {
      console.error('로그아웃 오류:', error);
    }
  };

  // 사용자 이름의 첫 글자 가져오기
  const getUserInitial = () => {
    if (userProfile?.name && userProfile.name !== '관리자' && userProfile.name !== '사용자') {
      return userProfile.name.charAt(0).toUpperCase();
    }
    const email = userProfile?.email || user?.email;
    if (email) {
      return email.charAt(0).toUpperCase();
    }
    return 'U';
  };

  const getDisplayUserName = () => {
    if (userProfile?.name && userProfile.name !== '관리자' && userProfile.name !== '사용자') {
      return userProfile.name;
    }
    const email = userProfile?.email || user?.email;
    if (email) {
      const localPart = email.split('@')[0];
      return localPart || '사용자';
    }
    return '사용자';
  };

  return (
    <header className="sticky top-0 z-50 bg-blue-500 shadow-lg">
      <div className="w-full max-w-[1600px] mx-auto px-1 sm:px-2 lg:px-3">
        <div className="flex justify-between items-center h-14 sm:h-16 min-w-0 gap-1">
          {/* 로고 및 브랜드 */}
          <div className="flex items-center min-w-0">
            <div className="flex-shrink-0">
              <Link href="/" className="hover:opacity-80 transition-opacity">
                <h1 className="text-lg sm:text-2xl font-bold text-white cursor-pointer truncate">
                  SG-LOK Work Flow
                </h1>
              </Link>
            </div>
          </div>

          {/* 데스크톱 네비게이션 */}
          {!isAuthPage && (
            <nav className="hidden md:flex items-center gap-2 lg:gap-3 min-w-0">
              <Link
                href="/dashboard"
                className={`px-4 py-2.5 rounded-md text-base font-semibold transition-colors shadow-sm whitespace-nowrap ${
                  isActivePath('/dashboard')
                    ? 'bg-blue-700 text-white'
                    : 'text-white hover:bg-blue-600 hover:text-white'
                }`}
              >
                대시보드
              </Link>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsProdMenuOpen((prev) => !prev);
                    setIsCertMenuOpen(false);
                    setIsInventoryMenuOpen(false);
                    setIsDealerMenuOpen(false);
                    setIsSubstituteMenuOpen(false);
                  }}
                  className={`px-4 py-2.5 rounded-md text-base font-semibold transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap ${
                    isActivePath('/production')
                      ? 'bg-blue-700 text-white'
                      : 'text-white hover:bg-blue-600 hover:text-white'
                  }`}
                >
                  생산관리
                  <svg
                    className={`w-4 h-4 transition-transform ${isProdMenuOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isProdMenuOpen && (
                  <>
                    {/* 배경 클릭 시 메뉴 닫기 */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsProdMenuOpen(false);
                      }}
                    />
                    <div className="absolute left-0 mt-1 w-48 rounded-lg bg-white shadow-lg border border-gray-200 z-20" onClick={(e) => e.stopPropagation()}>
                      <div className="py-2">
                        <Link
                          href="/production"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsProdMenuOpen(false)}
                        >
                          생산관리 메인
                        </Link>
                        <Link
                          href="/production/request"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsProdMenuOpen(false)}
                        >
                          생산요청 등록
                        </Link>
                        <Link
                          href="/production/list"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsProdMenuOpen(false)}
                        >
                          생산요청 목록
                        </Link>
                        <Link
                          href="/production/calendar"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsProdMenuOpen(false)}
                        >
                          생산일정 캘린더
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsCertMenuOpen((prev) => !prev);
                    setIsProdMenuOpen(false);
                    setIsInventoryMenuOpen(false);
                    setIsDealerMenuOpen(false);
                    setIsSubstituteMenuOpen(false);
                  }}
                  className={`px-4 py-2.5 rounded-md text-base font-semibold transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap ${
                    isActivePath('/certificate')
                      ? 'bg-blue-700 text-white'
                      : 'text-white hover:bg-blue-600 hover:text-white'
                  }`}
                >
                  성적서관리
                  <svg
                    className={`w-4 h-4 transition-transform ${isCertMenuOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isCertMenuOpen && (
                  <>
                    {/* 배경 클릭 시 메뉴 닫기 */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsCertMenuOpen(false);
                      }}
                    />
                    <div className="absolute left-0 mt-1 w-48 rounded-lg bg-white shadow-lg border border-gray-200 z-20" onClick={(e) => e.stopPropagation()}>
                      <div className="py-2">
                        <Link
                          href="/certificate"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsCertMenuOpen(false)}
                        >
                          성적서관리 메인
                        </Link>
                        <Link
                          href="/certificate/request"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsCertMenuOpen(false)}
                        >
                          성적서요청 등록
                        </Link>
                        <Link
                          href="/certificate/list"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsCertMenuOpen(false)}
                        >
                          성적서 목록
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsInventoryMenuOpen((prev) => !prev);
                    setIsProdMenuOpen(false);
                    setIsCertMenuOpen(false);
                    setIsDealerMenuOpen(false);
                    setIsSubstituteMenuOpen(false);
                  }}
                  className={`px-4 py-2.5 rounded-md text-base font-semibold transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap ${
                    isActivePath('/inventory')
                      ? 'bg-blue-700 text-white'
                      : 'text-white hover:bg-blue-600 hover:text-white'
                  }`}
                >
                  재고관리
                  <svg
                    className={`w-4 h-4 transition-transform ${isInventoryMenuOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isInventoryMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsInventoryMenuOpen(false);
                      }}
                    />
                    <div className="absolute left-0 mt-1 w-48 rounded-lg bg-white shadow-lg border border-gray-200 z-20" onClick={(e) => e.stopPropagation()}>
                      <div className="py-2">
                        <Link
                          href="/inventory"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsInventoryMenuOpen(false)}
                        >
                          재고관리 메인
                        </Link>
                        <Link
                          href="/inventory/status"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsInventoryMenuOpen(false)}
                        >
                          UHP 재고현황
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsDealerMenuOpen((prev) => !prev);
                    setIsProdMenuOpen(false);
                    setIsCertMenuOpen(false);
                    setIsInventoryMenuOpen(false);
                    setIsSubstituteMenuOpen(false);
                  }}
                  className="px-4 py-2.5 rounded-md text-base font-semibold transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap text-white hover:bg-blue-600 hover:text-white"
                >
                  대리점관리
                  <svg
                    className={`w-4 h-4 transition-transform ${isDealerMenuOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isDealerMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDealerMenuOpen(false);
                      }}
                    />
                    <div className="absolute left-0 mt-1 w-52 rounded-lg bg-white shadow-lg border border-gray-200 z-20" onClick={(e) => e.stopPropagation()}>
                      <div className="py-2">
                        <Link
                          href="/dealer-customers"
                          className={`block px-4 py-2 text-sm hover:bg-gray-50 hover:text-blue-600 hover:font-semibold ${
                            isActivePath('/dealer-customers')
                              ? 'bg-blue-50 text-blue-600 font-semibold'
                              : 'text-gray-800'
                          }`}
                          onClick={() => setIsDealerMenuOpen(false)}
                        >
                          대리점 담당고객
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsSubstituteMenuOpen((prev) => !prev);
                    setIsProdMenuOpen(false);
                    setIsCertMenuOpen(false);
                    setIsInventoryMenuOpen(false);
                    setIsDealerMenuOpen(false);
                  }}
                  className={`px-4 py-2.5 rounded-md text-base font-semibold transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap ${
                    isActivePath('/substitute')
                      ? 'bg-blue-700 text-white'
                      : 'text-white hover:bg-blue-600 hover:text-white'
                  }`}
                >
                  대체품코드
                  <svg
                    className={`w-4 h-4 transition-transform ${isSubstituteMenuOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isSubstituteMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsSubstituteMenuOpen(false);
                      }}
                    />
                    <div
                      className="absolute left-0 mt-1 w-52 rounded-lg bg-white shadow-lg border border-gray-200 z-20"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="py-2">
                        <Link
                          href="/substitute"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsSubstituteMenuOpen(false)}
                        >
                          대체품코드 메인
                        </Link>
                        <Link
                          href="/substitute/menu"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsSubstituteMenuOpen(false)}
                        >
                          코드 등록
                        </Link>
                        <Link
                          href="/substitute/list"
                          className="block px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 hover:text-blue-600 hover:font-semibold"
                          onClick={() => setIsSubstituteMenuOpen(false)}
                        >
                          코드 목록
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <Link
                href="/notices"
                className={`px-4 py-2.5 rounded-md text-base font-semibold transition-colors shadow-sm whitespace-nowrap ${
                  isActivePath('/notices')
                    ? 'bg-blue-700 text-white'
                    : 'text-white hover:bg-blue-600 hover:text-white'
                }`}
              >
                공지사항
              </Link>
            </nav>
          )}

          {/* 우측 메뉴 */}
          <div className="flex items-center space-x-4">
            {loading ? (
              // 로딩 중일 때는 아무것도 표시하지 않음 (깜빡임 방지)
              <div className="w-8 h-8"></div>
            ) : isAuthenticated ? (
              <div className="relative">
                {/* 사용자 메뉴 버튼 */}
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center space-x-2 text-white hover:opacity-80 transition-opacity"
                >
                  <div className="w-8 h-8 rounded-full bg-white text-blue-600 flex items-center justify-center font-semibold text-sm">
                    {getUserInitial()}
                  </div>
                  <span className="hidden md:block text-base font-medium">
                    {getDisplayUserName()}
                  </span>
                  <svg
                    className={`w-4 h-4 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* 사용자 드롭다운 메뉴 */}
                {isUserMenuOpen && (
                  <>
                    {/* 배경 클릭 시 메뉴 닫기 */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setIsUserMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-[min(16rem,calc(100vw-1.5rem))] sm:w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-[60]">
                      <div className="p-4 border-b border-gray-200">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-gray-900">{getDisplayUserName()}</h3>
                          <button
                            onClick={() => setIsUserMenuOpen(false)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{userProfile?.email || user?.email || ''}</p>
                      </div>
                      <div className="border-t border-gray-200 py-2">
                        <Link
                          href="/inquiry"
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          문의하기
                        </Link>
                        <Link
                          href="/mypage"
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          회원정보 관리
                        </Link>
                      </div>
                      <div className="border-t border-gray-200 py-2">
                        <button
                          onClick={handleSignOut}
                          className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50"
                        >
                          로그아웃
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
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
          <div className="md:hidden pb-3 border-t border-blue-400/40 max-h-[min(70vh,28rem)] overflow-y-auto overscroll-contain">
            <nav className="flex flex-col py-2">
              <Link
                href="/dashboard"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-semibold transition-colors ${
                  isActivePath('/dashboard')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                대시보드
              </Link>

              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-blue-100/90">생산관리</p>
              <Link
                href="/production"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/production')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                생산관리 메인
              </Link>
              <Link
                href="/production/request"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/production/request')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                생산요청 등록
              </Link>
              <Link
                href="/production/list"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/production/list')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                생산요청 목록
              </Link>
              <Link
                href="/production/calendar"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/production/calendar')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                생산일정 캘린더
              </Link>

              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-blue-100/90">성적서관리</p>
              <Link
                href="/certificate"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/certificate') && !isActivePath('/certificate/request') && !isActivePath('/certificate/list')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                성적서관리 메인
              </Link>
              <Link
                href="/certificate/request"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/certificate/request')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                성적서요청 등록
              </Link>
              <Link
                href="/certificate/list"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/certificate/list')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                성적서 목록
              </Link>

              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-blue-100/90">재고관리</p>
              <Link
                href="/inventory"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/inventory') && !isActivePath('/inventory/status')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                재고관리 메인
              </Link>
              <Link
                href="/inventory/status"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/inventory/status')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                UHP 재고현황
              </Link>

              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-blue-100/90">대리점관리</p>
              <Link
                href="/dealer-customers"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/dealer-customers')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                대리점 담당고객
              </Link>

              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-blue-100/90">대체품코드</p>
              <Link
                href="/substitute"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/substitute') &&
                  !isActivePath('/substitute/menu') &&
                  !isActivePath('/substitute/list')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                대체품코드 메인
              </Link>
              <Link
                href="/substitute/menu"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/substitute/menu')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                코드 등록
              </Link>
              <Link
                href="/substitute/list"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-colors ${
                  isActivePath('/substitute/list')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                코드 목록
              </Link>

              <Link
                href="/notices"
                className={`mx-2 px-4 py-2.5 rounded-lg text-[15px] font-semibold transition-colors ${
                  isActivePath('/notices')
                    ? 'bg-blue-700 text-white'
                    : 'text-white/95 hover:bg-blue-600'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                공지사항
              </Link>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}

