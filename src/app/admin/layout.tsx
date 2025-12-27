"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const ADMIN_SESSION_KEY = 'admin_session';

// 관리자 인증 확인 함수
const checkAdminAuth = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  const sessionData = localStorage.getItem(ADMIN_SESSION_KEY);
  if (!sessionData) return false;
  
  try {
    const session = JSON.parse(sessionData);
    const now = new Date().getTime();
    
    if (now > session.expiresAt) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    
    return session.authenticated === true;
  } catch {
    return false;
  }
};

type MenuItem = {
  id: string;
  label: string;
  path?: string;
  icon: React.ReactNode;
  subItems?: { id: string; label: string; path: string }[];
};

const adminMenuItems: MenuItem[] = [
  {
    id: 'home',
    label: '관리자 대시보드',
    path: '/admin/dashboard',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    id: 'users',
    label: '회원 관리',
    path: '/admin/users',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    id: 'inquiries',
    label: '문의 관리',
    path: '/admin/inquiries',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
  {
    id: 'production',
    label: '생산관리',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
      </svg>
    ),
    subItems: [
      { id: 'production-request', label: '생산요청 등록', path: '/admin/production/request' },
      { id: 'production-list', label: '생산요청 목록', path: '/admin/production' },
      { id: 'production-calendar', label: '생산일정 캘린더', path: '/admin/production/calendar' },
    ],
  },
  {
    id: 'certificate',
    label: '성적서관리',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    subItems: [
      { id: 'certificate-request', label: '성적서요청 등록', path: '/admin/certificate/request' },
      { id: 'certificate-list', label: '성적서 목록', path: '/admin/certificate' },
    ],
  },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set());
  const [pendingUserCount, setPendingUserCount] = useState<number>(0);

  // 로그인 페이지는 레이아웃 적용 안 함
  const isLoginPage = pathname === '/admin/login' || pathname?.startsWith('/admin/login');

  useEffect(() => {
    // pathname이 아직 로드되지 않았으면 대기
    if (!pathname) {
      return;
    }

    // 로그인 페이지에서는 인증 체크 안 함
    if (pathname === '/admin/login' || pathname.startsWith('/admin/login')) {
      setLoading(false);
      return;
    }

    const isAdmin = checkAdminAuth();
    setIsAdminAuthenticated(isAdmin);
    setLoading(false);
    
    if (!isAdmin) {
      router.push('/admin/login');
    }

    // 생산관리 관련 페이지일 때 메뉴 자동 확장
    if (pathname?.startsWith('/admin/production')) {
      setExpandedMenus(prev => new Set(prev).add('production'));
    }
    // 성적서관리 관련 페이지일 때 메뉴 자동 확장
    if (pathname?.startsWith('/admin/certificate')) {
      setExpandedMenus(prev => new Set(prev).add('certificate'));
    }
  }, [router, pathname]);

  // 승인 대기 회원 수 실시간 구독
  useEffect(() => {
    if (!isAdminAuthenticated) return;

    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('approved', '==', false));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setPendingUserCount(snapshot.size);
      },
      (error) => {
        console.error('승인 대기 회원 수 조회 오류:', error);
        setPendingUserCount(0);
      }
    );

    return () => unsubscribe();
  }, [isAdminAuthenticated]);

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    router.push('/admin/login');
  };

  // 로그인 페이지는 레이아웃 없이 그대로 표시 (pathname이 null이거나 로그인 페이지인 경우)
  if (!pathname || isLoginPage) {
    return <>{children}</>;
  }

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

  if (!isAdminAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="flex-1 flex overflow-hidden">
        {/* 좌측 메뉴 */}
        <aside className="w-48 bg-white border-r border-gray-200 shadow-sm flex flex-col h-screen">
          <div className="p-3 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">관리자 메뉴</h2>
          </div>
          <nav className="p-2 flex-1 overflow-y-auto">
            {adminMenuItems.map((item) => {
              const hasSubItems = item.subItems && item.subItems.length > 0;
              const isExpanded = expandedMenus.has(item.id);
              
              // 서브 메뉴가 있는 경우: 메인 메뉴 경로가 활성화되어 있거나 서브 메뉴 중 하나가 활성화되어 있으면 메인 메뉴도 활성화
              // 서브 메뉴가 없는 경우: 메인 메뉴 경로가 정확히 일치하거나 하위 경로일 때 활성화
              const normalizePath = (path: string | undefined) => path ? path.replace(/\/$/, '') : '';
              const normalizedItemPath = normalizePath(item.path);
              const normalizedPathname = normalizePath(pathname);
              
              const isMainActive = hasSubItems
                ? (normalizedItemPath && normalizedPathname && (normalizedPathname === normalizedItemPath || normalizedPathname.startsWith(`${normalizedItemPath}/`))) ||
                  item.subItems?.some(subItem => {
                    const subPath = subItem.path;
                    if (!subPath || !normalizedPathname) return false;
                    const normalizedSubPath = normalizePath(subPath);
                    // 정확한 경로 일치를 먼저 확인
                    if (normalizedPathname === normalizedSubPath) return true;
                    // /admin/production의 경우, 다른 서브 경로가 아닐 때만 활성화
                    if (normalizedSubPath === '/admin/production') {
                      const otherSubPaths = item.subItems
                        ?.filter(s => s.path !== subPath)
                        .map(s => normalizePath(s.path)) || [];
                      const isOtherSubPath = otherSubPaths.some(otherPath => 
                        normalizedPathname === otherPath || normalizedPathname.startsWith(`${otherPath}/`)
                      );
                      if (normalizedPathname.startsWith(`${normalizedSubPath}/`) && !isOtherSubPath) {
                        return true;
                      }
                    } else {
                      // 다른 서브 메뉴는 하위 경로일 때만 활성화
                      if (normalizedPathname.startsWith(`${normalizedSubPath}/`)) {
                        return true;
                      }
                    }
                    return false;
                  })
                : normalizedItemPath 
                  ? (normalizedPathname === normalizedItemPath || (normalizedItemPath && normalizedPathname?.startsWith(`${normalizedItemPath}/`)))
                  : false;

              return (
                <div key={item.id} className="mb-1">
                  {hasSubItems ? (
                    <>
                      {item.path ? (
                        <Link
                          href={item.path}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-colors ${
                            isMainActive
                              ? 'bg-blue-50 text-blue-600 font-semibold'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                          onClick={(e) => {
                            e.preventDefault();
                            setExpandedMenus(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(item.id)) {
                                newSet.delete(item.id);
                              } else {
                                newSet.add(item.id);
                              }
                              return newSet;
                            });
                            router.push(item.path || '#');
                          }}
                        >
                          <div className="flex items-center gap-2">
                            {item.icon}
                            <span className="text-sm flex items-center gap-1">
                              {item.label}
                              {item.id === 'users' && pendingUserCount > 0 && (
                                <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold">
                                  {pendingUserCount}
                                </span>
                              )}
                            </span>
                          </div>
                          <svg
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'transform rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </Link>
                      ) : (
                        <button
                          onClick={() => {
                            setExpandedMenus(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(item.id)) {
                                newSet.delete(item.id);
                              } else {
                                newSet.add(item.id);
                              }
                              return newSet;
                            });
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-colors ${
                            isMainActive
                              ? 'bg-blue-50 text-blue-600 font-semibold'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {item.icon}
                            <span className="text-sm flex items-center gap-1">
                              {item.label}
                              {item.id === 'users' && pendingUserCount > 0 && (
                                <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold">
                                  {pendingUserCount}
                                </span>
                              )}
                            </span>
                          </div>
                          <svg
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'transform rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      )}
                      {isExpanded && item.subItems && (
                        <div className="ml-3 mt-1 space-y-1">
                          {item.subItems.map((subItem) => {
                            // 정확한 경로 일치 확인
                            let isSubActive = false;
                            if (subItem.path && pathname) {
                              const normalizedSubPath = normalizePath(subItem.path);
                              const normalizedPathname = normalizePath(pathname);
                              
                              // 정확히 일치하는 경우
                              if (normalizedPathname === normalizedSubPath) {
                                isSubActive = true;
                              } else if (subItem.path === '/admin/production' || subItem.path === '/admin/certificate') {
                                // /admin/production 또는 /admin/certificate의 경우, 정확히 일치하거나 하위 경로로 시작하되
                                // 다른 서브 메뉴 경로가 아닐 때만 활성화
                                const otherSubPaths = item.subItems
                                  ?.filter(s => s.path !== subItem.path)
                                  .map(s => normalizePath(s.path)) || [];
                                const isOtherSubPath = otherSubPaths.some(otherPath => 
                                  normalizedPathname === otherPath || normalizedPathname.startsWith(`${otherPath}/`)
                                );
                                if (normalizedPathname.startsWith(`${normalizedSubPath}/`) && !isOtherSubPath) {
                                  isSubActive = true;
                                }
                              } else {
                                // 다른 서브 메뉴는 정확히 일치하거나 하위 경로일 때만 활성화
                                if (normalizedPathname.startsWith(`${normalizedSubPath}/`)) {
                                  isSubActive = true;
                                }
                              }
                            }
                            return (
                              <Link
                                key={subItem.id}
                                href={subItem.path}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                                  isSubActive
                                    ? 'bg-blue-50 text-blue-600 font-semibold'
                                    : 'text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                <span className="text-xs">{subItem.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <Link
                      href={item.path || '#'}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                        isMainActive
                          ? 'bg-blue-50 text-blue-600 font-semibold'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {item.icon}
                      <span className="text-sm">{item.label}</span>
                    </Link>
                  )}
                </div>
              );
            })}
          </nav>
          <div className="p-3 border-t border-gray-200 flex-shrink-0 space-y-2">
            <a
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="text-sm">홈페이지</span>
            </a>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="text-sm">로그아웃</span>
            </button>
          </div>
        </aside>

        {/* 우측 콘텐츠 영역 */}
        <main className="flex-1 overflow-y-auto h-screen">
          {children}
        </main>
      </div>
    </div>
  );
}

