"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { collection, doc, query, where, onSnapshot, getDocs, orderBy, limit } from 'firebase/firestore';
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

export default function AdminPage() {
  const router = useRouter();
  const [userStats, setUserStats] = useState({
    total: 0,
    pending: 0,
    approved: 0,
  });
  const [inquiryStats, setInquiryStats] = useState({
    total: 0,
    pending: 0,
    read: 0,
    replied: 0,
  });
  const [productionStats, setProductionStats] = useState({
    total: 0,
    pendingReview: 0,
    inProgress: 0,
    completed: 0,
  });
  const [certificateStats, setCertificateStats] = useState({
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
  });
  const [inventoryStats, setInventoryStats] = useState({
    totalItems: 0,
    inStock: 0,
    outOfStock: 0,
    planExists: 0,
  });
  const [substituteStats, setSubstituteStats] = useState({
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 인증 체크 먼저 수행
    const isAdmin = checkAdminAuth();
    
    if (!isAdmin) {
      // 인증되지 않으면 로그인 페이지로 즉시 리다이렉트
      window.location.href = '/admin/login';
      return;
    }

    // 초기 로딩 상태 해제
    setLoading(false);

    // 회원 통계 구독
    const usersRef = collection(db, 'users');
    const unsubscribeUsers = onSnapshot(
      usersRef,
      (snapshot) => {
        let pendingCount = 0;
        let approvedCount = 0;
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.approved === false) {
            pendingCount++;
          } else {
            approvedCount++;
          }
        });

        setUserStats({
          total: snapshot.size,
          pending: pendingCount,
          approved: approvedCount,
        });
      },
      (error) => {
        console.error('회원 통계 조회 오류:', error);
      }
    );

    // 문의 통계 구독
    const inquiriesRef = collection(db, 'inquiries');
    const unsubscribeInquiries = onSnapshot(
      inquiriesRef,
      (snapshot) => {
        let pendingCount = 0;
        let readCount = 0;
        let repliedCount = 0;

        snapshot.forEach((doc) => {
          const data = doc.data();
          const status = data.status || 'pending';
          if (status === 'pending') {
            pendingCount++;
          } else if (status === 'read') {
            readCount++;
          } else if (status === 'replied') {
            repliedCount++;
          }
        });

        setInquiryStats({
          total: snapshot.size,
          pending: pendingCount,
          read: readCount,
          replied: repliedCount,
        });
      },
      (error) => {
        console.error('문의 통계 조회 오류:', error);
      }
    );

    // 생산 요청 통계 구독
    const productionRequestsRef = collection(db, 'productionRequests');
    const unsubscribeProduction = onSnapshot(
      productionRequestsRef,
      (snapshot) => {
        let pendingReviewCount = 0;
        let inProgressCount = 0;
        let completedCount = 0;

        snapshot.forEach((doc) => {
          const data = doc.data();
          const status = data.status;
          if (status === 'pending_review') {
            pendingReviewCount++;
          } else if (status === 'confirmed' || status === 'in_progress') {
            inProgressCount++;
          } else if (status === 'completed') {
            completedCount++;
          }
        });

        setProductionStats({
          total: snapshot.size,
          pendingReview: pendingReviewCount,
          inProgress: inProgressCount,
          completed: completedCount,
        });
      },
      (error) => {
        console.error('생산 요청 통계 조회 오류:', error);
      }
    );

    // 성적서 통계 구독
    const certificatesRef = collection(db, 'certificates');
    const unsubscribeCertificates = onSnapshot(
      certificatesRef,
      (snapshot) => {
        let pendingCount = 0;
        let inProgressCount = 0;
        let completedCount = 0;
        let totalCount = 0;

        snapshot.forEach((doc) => {
          const data = doc.data();
          
          // 생산요청 데이터 필터링
          if (data.productionReason) {
            return;
          }
          
          // 성적서 데이터인지 확인
          if (!data.certificateType && !data.requestDate) {
            return;
          }
          
          totalCount++;
          const status = data.status || 'pending';
          if (status === 'pending') {
            pendingCount++;
          } else if (status === 'in_progress') {
            inProgressCount++;
          } else if (status === 'completed') {
            completedCount++;
          }
        });

        setCertificateStats({
          total: totalCount,
          pending: pendingCount,
          inProgress: inProgressCount,
          completed: completedCount,
        });
      },
      (error) => {
        console.error('성적서 통계 조회 오류:', error);
      }
    );

    // 재고 통계 구독 (품목 기준: 재고 보유 / 미보유)
    const inventoryRef = doc(db, 'inventory', 'microWeldProducts');
    const unsubscribeInventory = onSnapshot(
      inventoryRef,
      (snapshot) => {
        const data = snapshot.data() as
          | {
              products?: Array<{
                items?: Array<{
                  currentStock?: number;
                  variants?: Array<{ currentStock?: number }>;
                  productionPlanHistory?: Array<{ plannedQuantity?: number }>;
                }>;
              }>;
              tubeButtWeldProducts?: Array<{
                items?: Array<{
                  currentStock?: number;
                  variants?: Array<{ currentStock?: number }>;
                  productionPlanHistory?: Array<{ plannedQuantity?: number }>;
                }>;
              }>;
              metalFaceSealProducts?: Array<{
                items?: Array<{
                  currentStock?: number;
                  variants?: Array<{ currentStock?: number }>;
                  productionPlanHistory?: Array<{ plannedQuantity?: number }>;
                }>;
              }>;
            }
          | undefined;

        const getItemStock = (item: {
          currentStock?: number;
          variants?: Array<{ currentStock?: number }>;
        }): number => {
          if (Array.isArray(item.variants) && item.variants.length > 0) {
            return item.variants.reduce((sum, v) => sum + (typeof v.currentStock === 'number' ? v.currentStock : 0), 0);
          }
          return typeof item.currentStock === 'number' ? item.currentStock : 0;
        };

        let totalItemsCount = 0;
        let inStockCount = 0;
        let outOfStockCount = 0;
        let planExistsCount = 0;

        const slices = [
          ...(Array.isArray(data?.products) ? data.products : []),
          ...(Array.isArray(data?.tubeButtWeldProducts) ? data.tubeButtWeldProducts : []),
          ...(Array.isArray(data?.metalFaceSealProducts) ? data.metalFaceSealProducts : []),
        ];

        slices.forEach((product) => {
          const items = Array.isArray(product.items) ? product.items : [];
          items.forEach((item) => {
            totalItemsCount += 1;
            const stock = getItemStock(item);
            if (stock > 0) {
              inStockCount += 1;
            } else {
              outOfStockCount += 1;
            }
            const plans = Array.isArray(item.productionPlanHistory) ? item.productionPlanHistory : [];
            const totalPlanned = plans.reduce(
              (sum, plan) => sum + (typeof plan.plannedQuantity === 'number' ? plan.plannedQuantity : 0),
              0
            );
            if (totalPlanned > 0) {
              planExistsCount += 1;
            }
          });
        });

        setInventoryStats({
          totalItems: totalItemsCount,
          inStock: inStockCount,
          outOfStock: outOfStockCount,
          planExists: planExistsCount,
        });
      },
      (error) => {
        console.error('재고 통계 조회 오류:', error);
      }
    );

    // 대체품코드 통계 구독
    const mappingsRef = collection(db, 'mappings');
    const unsubscribeMappings = onSnapshot(
      mappingsRef,
      (snapshot) => {
        let totalCount = 0;
        snapshot.forEach((d) => {
          const data = d.data() as { manufacturer_from?: string; manufacturer_to?: string };
          if (data.manufacturer_from === 'SWAGELOK' && data.manufacturer_to === 'SLOK') {
            totalCount += 1;
          }
        });
        setSubstituteStats({ total: totalCount });
      },
      (error) => {
        console.error('대체품코드 통계 조회 오류:', error);
      }
    );

    return () => {
      unsubscribeUsers();
      unsubscribeInquiries();
      unsubscribeProduction();
      unsubscribeCertificates();
      unsubscribeInventory();
      unsubscribeMappings();
    };
  }, [router]);

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
    <div className="p-4 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">대시보드</h1>
          <p className="text-gray-600 text-sm">시스템 현황을 한눈에 확인하세요</p>
        </div>

        {/* 회원관리 섹션 */}
        <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">회원관리</h2>
          <div className="grid grid-cols-3 gap-2">
            <Link href="/admin/users" className="block h-full">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-2 sm:p-3 border border-blue-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] sm:text-xs font-medium text-gray-600 mb-0.5 whitespace-nowrap">전체 회원</p>
                    <p className="text-xl sm:text-2xl font-bold text-gray-900">{userStats.total}</p>
                  </div>
                  <div className="bg-blue-500 rounded-lg p-1.5 sm:p-2 shrink-0">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/users" className="block h-full">
              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-2 sm:p-3 border border-yellow-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] sm:text-xs font-medium text-gray-600 mb-0.5 whitespace-nowrap">승인 대기</p>
                    <p className="text-xl sm:text-2xl font-bold text-gray-900">{userStats.pending}</p>
                  </div>
                  <div className="bg-yellow-500 rounded-lg p-1.5 sm:p-2 shrink-0">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/users" className="block h-full">
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-2 sm:p-3 border border-green-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] sm:text-xs font-medium text-gray-600 mb-0.5 whitespace-nowrap">승인 완료</p>
                    <p className="text-xl sm:text-2xl font-bold text-gray-900">{userStats.approved}</p>
                  </div>
                  <div className="bg-green-500 rounded-lg p-1.5 sm:p-2 shrink-0">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
        </div>
      </div>

        {/* 문의관리 섹션 */}
        <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">문의관리</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Link href="/admin/inquiries" className="block h-full">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">전체 문의</p>
                    <p className="text-2xl font-bold text-gray-900">{inquiryStats.total}</p>
                  </div>
                  <div className="bg-blue-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/inquiries" className="block h-full">
              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-3 border border-yellow-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">대기중</p>
                    <p className="text-2xl font-bold text-gray-900">{inquiryStats.pending}</p>
                  </div>
                  <div className="bg-yellow-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/inquiries" className="block h-full">
              <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-lg p-3 border border-cyan-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">읽음</p>
                    <p className="text-2xl font-bold text-gray-900">{inquiryStats.read}</p>
                  </div>
                  <div className="bg-cyan-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/inquiries" className="block h-full">
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 border border-green-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">답변 완료</p>
                    <p className="text-2xl font-bold text-gray-900">{inquiryStats.replied}</p>
                  </div>
                  <div className="bg-green-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
        </div>
      </div>

        {/* 생산관리 섹션 */}
        <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">생산관리</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Link href="/admin/production" className="block h-full">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">전체 요청</p>
                    <p className="text-2xl font-bold text-gray-900">{productionStats.total}</p>
                  </div>
                  <div className="bg-blue-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/production?status=pending_review" className="block h-full">
              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-3 border border-yellow-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">대기중</p>
                    <p className="text-2xl font-bold text-gray-900">{productionStats.pendingReview}</p>
                  </div>
                  <div className="bg-yellow-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/production?status=in_progress" className="block h-full">
              <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-lg p-3 border border-cyan-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">진행중</p>
                    <p className="text-2xl font-bold text-gray-900">{productionStats.inProgress}</p>
                  </div>
                  <div className="bg-cyan-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/production?status=completed" className="block h-full">
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 border border-green-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">생산 완료</p>
                    <p className="text-2xl font-bold text-gray-900">{productionStats.completed}</p>
                  </div>
                  <div className="bg-green-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
        </div>
      </div>

        {/* 성적서관리 섹션 */}
        <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">성적서관리</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Link href="/admin/certificate" className="block h-full">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">전체 요청</p>
                    <p className="text-2xl font-bold text-gray-900">{certificateStats.total}</p>
                  </div>
                  <div className="bg-blue-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/certificate?status=pending" className="block h-full">
              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-3 border border-yellow-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">대기중</p>
                    <p className="text-2xl font-bold text-gray-900">{certificateStats.pending}</p>
                  </div>
                  <div className="bg-yellow-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/certificate?status=in_progress" className="block h-full">
              <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-lg p-3 border border-cyan-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">진행중</p>
                    <p className="text-2xl font-bold text-gray-900">{certificateStats.inProgress}</p>
                  </div>
                  <div className="bg-cyan-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/certificate?status=completed" className="block h-full">
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 border border-green-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">완료</p>
                    <p className="text-2xl font-bold text-gray-900">{certificateStats.completed}</p>
                  </div>
                  <div className="bg-green-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* 재고관리 섹션 */}
        <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">재고관리</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Link href="/admin/inventory/status" className="block h-full">
              <div className="bg-gradient-to-br from-sky-50 to-sky-100 rounded-lg p-3 border border-sky-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">전체 품목</p>
                    <p className="text-2xl font-bold text-gray-900">{inventoryStats.totalItems}</p>
                  </div>
                  <div className="bg-sky-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/inventory/status?stock=in" className="block h-full">
              <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-3 border border-indigo-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">품목 재고 보유</p>
                    <p className="text-2xl font-bold text-gray-900">{inventoryStats.inStock}</p>
                  </div>
                  <div className="bg-indigo-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0v10l-8 4m8-14l-8 4m0 10L4 17V7m8 4L4 7m8 4l8-4" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/inventory/status?stock=out" className="block h-full">
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3 border border-purple-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">품목 재고 미보유</p>
                    <p className="text-2xl font-bold text-gray-900">{inventoryStats.outOfStock}</p>
                  </div>
                  <div className="bg-purple-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2 1.586-1.586a2 2 0 012.828 0L20 14m-6-8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin/inventory/status?plan=exists" className="block h-full">
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg p-3 border border-emerald-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">생산계획 존재</p>
                    <p className="text-2xl font-bold text-gray-900">{inventoryStats.planExists}</p>
                  </div>
                  <div className="bg-emerald-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* 대체품코드 섹션 */}
        <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">대체품코드</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Link href="/admin/substitute/list" className="block h-full">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200 hover:shadow-md transition-all hover:scale-[1.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-0.5">전체 목록</p>
                    <p className="text-2xl font-bold text-gray-900">{substituteStats.total}</p>
                  </div>
                  <div className="bg-blue-500 rounded-lg p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

