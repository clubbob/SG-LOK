"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { hasEffectiveAdminAccess, isBootstrapAdminEmail } from '@/lib/auth/adminBootstrap';

const ADMIN_SESSION_KEY = 'admin_session';

// 관리자 인증 확인 함수
const checkAdminAuth = (): { ok: boolean; uid?: string } => {
  if (typeof window === 'undefined') return { ok: false };
  
  const sessionData = localStorage.getItem(ADMIN_SESSION_KEY);
  if (!sessionData) return { ok: false };
  
  try {
    const session = JSON.parse(sessionData);
    const now = new Date().getTime();
    
    if (now > session.expiresAt) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return { ok: false };
    }
    return {
      ok: session.authenticated === true && typeof session.uid === 'string' && session.uid.length > 0,
      uid: typeof session.uid === 'string' ? session.uid : undefined,
    };
  } catch {
    return { ok: false };
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
    id: 'users',
    label: '회원 / 권한 관리',
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
    id: 'notices',
    label: '공지사항',
    path: '/admin/notices',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118.5 14.158V11a6.002 6.002 0 00-4-5.659V4a1 1 0 10-2 0v1.341C9.67 5.165 8 7.388 8 10v4.159c0 .538-.214 1.055-.595 1.436L6 17h5m4 0v1a2 2 0 11-4 0v-1m4 0H6" />
      </svg>
    ),
  },
  {
    id: 'home',
    label: '대시보드',
    path: '/admin/dashboard',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
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
      { id: 'inspection-certi', label: '소재 사이즈 관리', path: '/admin/certificate/inspection' },
    ],
  },
  {
    id: 'inventory',
    label: '재고관리',
    path: '/admin/inventory/status',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0v10l-8 4m8-14l-8 4m0 10L4 17V7m8 4L4 7m8 4l8-4" />
      </svg>
    ),
    subItems: [
      { id: 'inventory-status', label: 'UHP 재고 관리', path: '/admin/inventory/status' },
      { id: 'inventory-products', label: '제품 이미지 등록', path: '/admin/inventory/products' },
    ],
  },
  {
    id: 'dealer-customers',
    label: '대리점관리',
    path: '/admin/dealer-customers',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V4H2v16h5m10 0v-2a4 4 0 00-8 0v2m8 0H9m0 0H7m2 0v-2a4 4 0 018 0v2M7 8h.01M7 12h.01M11 8h6M11 12h6" />
      </svg>
    ),
    subItems: [
      { id: 'dealer-customer-manage', label: '대리점 담당고객 관리', path: '/admin/dealer-customers' },
    ],
  },
  {
    id: 'substitute',
    label: '대체품코드',
    path: '/admin/substitute',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 7h16M4 12h16M4 17h10"
        />
      </svg>
    ),
    subItems: [
      { id: 'substitute-manage', label: '코드 등록', path: '/admin/substitute/manage' },
      { id: 'substitute-list', label: '코드 목록', path: '/admin/substitute/list' },
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // 로그인 페이지는 레이아웃 적용 안 함
  const isLoginPage = pathname === '/admin/login' || pathname?.startsWith('/admin/login');

  useEffect(() => {
    // pathname이 아직 로드되지 않았으면 대기
    if (!pathname) {
      return;
    }

    // 로그인 페이지나 /admin 루트 경로에서는 인증 체크 안 함 (page.tsx에서 처리)
    if (pathname === '/admin/login' || pathname.startsWith('/admin/login') || pathname === '/admin') {
      setLoading(false);
      return;
    }

    const verifyAdmin = async () => {
      const session = checkAdminAuth();
      if (!session.ok || !session.uid) {
        setIsAdminAuthenticated(false);
        setLoading(false);
        router.push('/admin/login');
        return;
      }

      try {
        const currentUser = auth.currentUser;
        if (!currentUser || currentUser.isAnonymous || currentUser.uid !== session.uid) {
          setIsAdminAuthenticated(false);
          setLoading(false);
          router.push('/admin/login');
          return;
        }
        const userSnap = await getDoc(doc(db, 'users', session.uid));
        const profile = userSnap.exists() ? userSnap.data() : null;
        const profileEmail =
          typeof profile?.email === 'string' ? profile.email : '';
        const emailForCheck = (currentUser.email || profileEmail).trim();
        const firestoreIsAdmin =
          profile && typeof profile.isAdmin === 'boolean' ? profile.isAdmin : undefined;
        const hasAdminRole = hasEffectiveAdminAccess({
          firestoreIsAdmin,
          email: emailForCheck,
        });

        // 문서에 isAdmin 필드가 아직 없을 때만 부트스트랩 계정에 true 동기화 (명시 false 는 덮어쓰지 않음)
        if (
          isBootstrapAdminEmail(emailForCheck) &&
          userSnap.exists() &&
          profile &&
          profile.isAdmin !== true &&
          profile.isAdmin !== false
        ) {
          try {
            await setDoc(
              doc(db, 'users', session.uid),
              { isAdmin: true, updatedAt: serverTimestamp() },
              { merge: true }
            );
          } catch (syncErr) {
            console.warn('부트스트랩 관리자 isAdmin 동기화 실패:', syncErr);
          }
        }

        setIsAdminAuthenticated(hasAdminRole);
        setLoading(false);
        if (!hasAdminRole) {
          localStorage.removeItem(ADMIN_SESSION_KEY);
          router.push('/admin/login');
          return;
        }
      } catch (e) {
        console.error('관리자 권한 검증 오류:', e);
        setIsAdminAuthenticated(false);
        setLoading(false);
        router.push('/admin/login');
        return;
      }

      // 생산관리 관련 페이지일 때 메뉴 자동 확장
      if (pathname?.startsWith('/admin/production')) {
        setExpandedMenus(prev => new Set(prev).add('production'));
      }
      // 성적서관리 관련 페이지일 때 메뉴 자동 확장
      if (pathname?.startsWith('/admin/certificate')) {
        setExpandedMenus(prev => new Set(prev).add('certificate'));
      }
      // 재고관리 관련 페이지일 때 메뉴 자동 확장
      if (pathname?.startsWith('/admin/inventory')) {
        setExpandedMenus(prev => new Set(prev).add('inventory'));
      }
      if (pathname?.startsWith('/admin/substitute')) {
        setExpandedMenus(prev => new Set(prev).add('substitute'));
      }
      if (pathname?.startsWith('/admin/dealer-customers')) {
        setExpandedMenus(prev => new Set(prev).add('dealer-customers'));
      }
    };
    verifyAdmin();
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

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    router.push('/admin/login');
  };

  const handleGoUserLogin = () => {
    // 로컬 개발 환경에서만 host를 바꿔 세션 충돌을 피하고,
    // 운영/스테이징 도메인에서는 현재 origin 그대로 이동한다.
    const { protocol, port, hostname, origin } = window.location;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    const targetOrigin = isLocalhost
      ? `${protocol}//${hostname === 'localhost' ? '127.0.0.1' : 'localhost'}${port ? `:${port}` : ''}`
      : origin;
    const userLoginUrl = `${targetOrigin}/login`;
    window.open(userLoginUrl, '_blank', 'noopener,noreferrer');
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
      {/* 모바일: 메뉴 열기 */}
      <div className="flex md:hidden items-center gap-2 px-3 py-2.5 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="p-2 rounded-lg text-gray-700 hover:bg-gray-100 -ml-1"
          aria-label="관리자 메뉴 열기"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-gray-900 truncate">관리자</span>
      </div>

      <div className="flex flex-1 relative">
        {mobileNavOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            aria-label="메뉴 닫기"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}

        {/* 좌측 메뉴 (모바일: 오버레이 드로어, md+: 고정 사이드바) */}
        <aside
          className={[
            'flex flex-col border-r border-gray-200 bg-white shadow-sm pb-12',
            'w-48 md:w-52 shrink-0 overflow-y-auto overscroll-contain',
            'fixed left-0 top-0 z-50 h-dvh transition-transform duration-200 ease-out',
            'md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0 md:shadow-sm',
            mobileNavOpen
              ? 'translate-x-0 pointer-events-auto'
              : '-translate-x-full md:translate-x-0 pointer-events-none md:pointer-events-auto',
          ].join(' ')}
        >
          <div className="p-3 border-b border-gray-200 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900">관리자 메뉴</h2>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              aria-label="메뉴 닫기"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
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
                <React.Fragment key={item.id}>
                  <div
                    className={`mb-1 ${
                      item.id === 'home'
                        ? 'border-t border-gray-200 pt-3 mt-3'
                        : ''
                    }`}
                  >
                  {hasSubItems ? (
                    <>
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
                </React.Fragment>
              );
            })}
          </nav>
          <div className="p-3 border-t border-gray-200 flex-shrink-0 space-y-2">
            <button
              type="button"
              onClick={handleGoUserLogin}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="text-sm">홈페이지</span>
            </button>
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

        {/* 우측 콘텐츠 영역: 문서(body) 스크롤 사용 */}
        <main className="flex-1 min-w-0 overflow-x-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

