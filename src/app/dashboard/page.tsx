"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MANUFACTURER } from '@/lib/substitute/constants';
import { fetchAllMappings } from '@/lib/substitute/firestoreMapping';

function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { code?: string };
  return maybe.code === 'permission-denied';
}

export default function DashboardPage() {
  const { isAuthenticated, loading, userProfile } = useAuth();
  const router = useRouter();
  const [productionStats, setProductionStats] = useState({
    totalRequests: 0,
    pendingReview: 0,
    inProgress: 0,
    completed: 0,
  });
  const [inquiryStats, setInquiryStats] = useState({
    totalInquiries: 0,
    pending: 0,
    read: 0,
    replied: 0,
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
  const [loadingStats, setLoadingStats] = useState(true);
  const [showLoginPopup, setShowLoginPopup] = useState(false);

  // 인증 확인 및 리다이렉트
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  // 로그인 팝업 표시 확인
  useEffect(() => {
    if (typeof window !== 'undefined' && !loading && isAuthenticated) {
      const showPopup = localStorage.getItem('show_login_popup');
      if (showPopup === 'true') {
        setShowLoginPopup(true);
        localStorage.removeItem('show_login_popup');
      }
    }
  }, [loading, isAuthenticated]);

  // 통계 및 최근 요청 불러오기
  useEffect(() => {
    if (isAuthenticated && userProfile) {
      loadDashboardData();
    }
  }, [isAuthenticated, userProfile]);

  const loadDashboardData = async () => {
    if (!userProfile) return;

    try {
      setLoadingStats(true);
      
      // 생산요청 통계 (본인 등록 건만)
      const requestsRef = collection(db, 'productionRequests');
      const requestsQuery = query(requestsRef, where('userId', '==', userProfile.id));
      const requestsSnapshot = await getDocs(requestsQuery);
      
      let pendingCount = 0;
      let inProgressCount = 0;
      let completedCount = 0;

      requestsSnapshot.forEach((doc) => {
        const data = doc.data();
        const status = data.status;
        
        if (status === 'pending_review') {
          pendingCount++;
        } else if (status === 'confirmed' || status === 'in_progress') {
          inProgressCount++;
        } else if (status === 'completed') {
          completedCount++;
        }
      });

      setProductionStats({
        totalRequests: requestsSnapshot.size,
        pendingReview: pendingCount,
        inProgress: inProgressCount,
        completed: completedCount,
      });

      // 문의하기 통계
      const inquiriesRef = collection(db, 'inquiries');
      const myInquiriesQuery = query(
        inquiriesRef,
        where('userId', '==', userProfile.id)
      );
      const inquiriesSnapshot = await getDocs(myInquiriesQuery);
      
      let pendingInquiryCount = 0;
      let readInquiryCount = 0;
      let repliedInquiryCount = 0;

      inquiriesSnapshot.forEach((doc) => {
        const data = doc.data();
        const status = data.status || 'pending';
        
        if (status === 'pending') {
          pendingInquiryCount++;
        } else if (status === 'read') {
          readInquiryCount++;
        } else if (status === 'replied') {
          repliedInquiryCount++;
        }
      });

      setInquiryStats({
        totalInquiries: inquiriesSnapshot.size,
        pending: pendingInquiryCount,
        read: readInquiryCount,
        replied: repliedInquiryCount,
      });

      // 성적서 통계 (본인 요청 건만)
      const certificatesRef = collection(db, 'certificates');
      const certificatesSnapshot = await getDocs(
        query(certificatesRef, where('userId', '==', userProfile.id))
      );
      
      let pendingCertCount = 0;
      let inProgressCertCount = 0;
      let completedCertCount = 0;
      let totalCertCount = 0;

      certificatesSnapshot.forEach((doc) => {
        const data = doc.data();
        
        // productionRequests 데이터가 certificates 컬렉션에 섞여 들어간 경우가 있어 방어
        if (data.productionReason) return;
        
        totalCertCount++;
        const status = data.status || 'pending';
        if (status === 'pending') {
          pendingCertCount++;
        } else if (status === 'in_progress') {
          inProgressCertCount++;
        } else if (status === 'completed') {
          completedCertCount++;
        }
      });

      setCertificateStats({
        total: totalCertCount,
        pending: pendingCertCount,
        inProgress: inProgressCertCount,
        completed: completedCertCount,
      });

      // 재고 통계 (관리자 대시보드와 동일: UHP 품목 기준)
      const inventorySnap = await getDoc(doc(db, 'inventory', 'microWeldProducts'));
      if (!inventorySnap.exists()) {
        setInventoryStats({
          totalItems: 0,
          inStock: 0,
          outOfStock: 0,
          planExists: 0,
        });
      } else {
        const invData = inventorySnap.data() as
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
            return item.variants.reduce(
              (sum, v) => sum + (typeof v.currentStock === 'number' ? v.currentStock : 0),
              0
            );
          }
          return typeof item.currentStock === 'number' ? item.currentStock : 0;
        };

        let totalItemsCount = 0;
        let inStockCount = 0;
        let outOfStockCount = 0;
        let planExistsCount = 0;

        const slices = [
          ...(Array.isArray(invData?.products) ? invData!.products! : []),
          ...(Array.isArray(invData?.tubeButtWeldProducts) ? invData!.tubeButtWeldProducts! : []),
          ...(Array.isArray(invData?.metalFaceSealProducts) ? invData!.metalFaceSealProducts! : []),
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
      }

      // 대체품코드 통계 (권한이 없으면 0으로 안전 처리)
      try {
        const mappings = await fetchAllMappings(db);
        const totalMappings = mappings.filter(
          (m) =>
            m.manufacturer_from === MANUFACTURER.SWAGELOK &&
            m.manufacturer_to === MANUFACTURER.SLOK
        ).length;
        setSubstituteStats({
          total: totalMappings,
        });
      } catch (e) {
        if (!isPermissionDeniedError(e)) {
          console.error('대체품코드 통계 로드 오류:', e);
        }
        setSubstituteStats({
          total: 0,
        });
      }
    } catch (error) {
      console.error('대시보드 데이터 로드 오류:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  if (loading || loadingStats) {
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
      {/* 로그인 팝업 */}
      {showLoginPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="text-center">
              <div className="mb-4">
                <svg className="w-16 h-16 text-blue-600 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">로그인 완료</h2>
              <p className="text-gray-700 mb-2 text-lg">
                사용 중 불편한 점, 개선할 점 알려주세요.
              </p>
              <p className="text-gray-600 mb-6 text-base">
                작지만 강한 회사가 되도록 노력합시다
              </p>
              <button
                onClick={() => setShowLoginPopup(false)}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-semibold"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
      <main className="flex-1 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {/* 헤더 */}
          <div className="mb-4">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">대시보드</h1>
            <p className="text-gray-600 text-sm">
              {userProfile?.name}님, 안녕하세요! 오늘도 좋은 하루 되세요.
            </p>
          </div>

          {/* 문의하기 통계 카드 */}
          <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h2 className="text-base font-semibold text-gray-900 mb-3">문의하기</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Link href="/mypage/inquiries" className="block h-full">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-0.5">전체 문의</p>
                      <p className="text-2xl font-bold text-gray-900">{inquiryStats.totalInquiries}</p>
                    </div>
                    <div className="bg-blue-500 rounded-lg p-2">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>

              <Link href="/mypage/inquiries?status=pending" className="block h-full">
                <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-3 border border-yellow-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

              <Link href="/mypage/inquiries?status=read" className="block h-full">
                <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-lg p-3 border border-cyan-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

              <Link href="/mypage/inquiries?status=replied" className="block h-full">
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 border border-green-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

          {/* 생산관리 통계 카드 */}
          <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h2 className="text-base font-semibold text-gray-900 mb-3">생산관리</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Link href="/production/list" className="block h-full">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-0.5">전체 요청</p>
                      <p className="text-2xl font-bold text-gray-900">{productionStats.totalRequests}</p>
                    </div>
                    <div className="bg-blue-500 rounded-lg p-2">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>

              <Link href="/production/list?status=pending_review" className="block h-full">
                <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-3 border border-yellow-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

              <Link href="/production/list?status=in_progress" className="block h-full">
                <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-lg p-3 border border-cyan-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

              <Link href="/production/list?status=completed" className="block h-full">
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 border border-green-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

          {/* 성적서관리 통계 카드 */}
          <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h2 className="text-base font-semibold text-gray-900 mb-3">성적서관리</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Link href="/certificate/list" className="block h-full">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

              <Link href="/certificate/list?status=pending" className="block h-full">
                <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-3 border border-yellow-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

              <Link href="/certificate/list?status=in_progress" className="block h-full">
                <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-lg p-3 border border-cyan-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

              <Link href="/certificate/list?status=completed" className="block h-full">
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 border border-green-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
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

          {/* 재고관리 통계 카드 (관리자 대시보드와 동일 지표) */}
          <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h2 className="text-base font-semibold text-gray-900 mb-3">재고관리</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Link href="/inventory/status" className="block h-full">
                <div className="bg-gradient-to-br from-sky-50 to-sky-100 rounded-lg p-3 border border-sky-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-0.5">전체 품목</p>
                      <p className="text-2xl font-bold text-gray-900">{inventoryStats.totalItems}</p>
                    </div>
                    <div className="bg-sky-500 rounded-lg p-2">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>

              <Link href="/inventory/status?stock=in" className="block h-full">
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-3 border border-indigo-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-0.5">품목 재고 보유</p>
                      <p className="text-2xl font-bold text-gray-900">{inventoryStats.inStock}</p>
                    </div>
                    <div className="bg-indigo-500 rounded-lg p-2">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M20 7l-8-4-8 4m16 0v10l-8 4m8-14l-8 4m0 10L4 17V7m8 4L4 7m8 4l8-4"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>

              <Link href="/inventory/status?stock=out" className="block h-full">
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3 border border-purple-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-0.5">품목 재고 미보유</p>
                      <p className="text-2xl font-bold text-gray-900">{inventoryStats.outOfStock}</p>
                    </div>
                    <div className="bg-purple-500 rounded-lg p-2">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2 1.586-1.586a2 2 0 012.828 0L20 14m-6-8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>

              <Link href="/inventory/status?plan=exists" className="block h-full">
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg p-3 border border-emerald-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-0.5">생산계획 존재</p>
                      <p className="text-2xl font-bold text-gray-900">{inventoryStats.planExists}</p>
                    </div>
                    <div className="bg-emerald-500 rounded-lg p-2">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          </div>

          {/* 대체품코드 바로가기 */}
          <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h2 className="text-base font-semibold text-gray-900 mb-3">대체품코드</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Link href="/substitute/list" className="block h-full">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200 hover:shadow-md transition-all hover:scale-[1.02] h-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-0.5">전체 목록</p>
                      <p className="text-2xl font-bold text-gray-900">{substituteStats.total}</p>
                    </div>
                    <div className="bg-blue-500 rounded-lg p-2">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

