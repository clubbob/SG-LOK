"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ProductionRequest, Inquiry } from '@/types';

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
      
      // 생산요청 통계 (모든 생산요청 기준)
      const requestsRef = collection(db, 'productionRequests');
      const requestsQuery = query(requestsRef);
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

      // 성적서 통계 (본인이 작성한 성적서만)
      const certificatesRef = collection(db, 'certificates');
      const certificatesQuery = query(
        certificatesRef,
        where('userId', '==', userProfile.id)
      );
      const certificatesSnapshot = await getDocs(certificatesQuery);
      
      let pendingCertCount = 0;
      let inProgressCertCount = 0;
      let completedCertCount = 0;
      let totalCertCount = 0;

      certificatesSnapshot.forEach((doc) => {
        const data = doc.data();
        
        // 생산요청 데이터 필터링
        if (data.productionReason) {
          return;
        }
        
        // 성적서 데이터인지 확인
        if (!data.certificateType && !data.requestDate) {
          return;
        }
        
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* 헤더 */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">대시보드</h1>
            <p className="text-gray-600">
              {userProfile?.name}님, 안녕하세요! 오늘도 좋은 하루 되세요.
            </p>
          </div>

          {/* 문의하기 통계 카드 */}
          <div className="mb-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">문의하기</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div 
                onClick={() => router.push('/mypage/inquiries')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-blue-500 cursor-pointer h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">전체 문의</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{inquiryStats.totalInquiries}</p>
                  </div>
                  <div className="bg-blue-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/mypage/inquiries')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-yellow-500 cursor-pointer h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">대기중</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{inquiryStats.pending}</p>
                  </div>
                  <div className="bg-yellow-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/mypage/inquiries')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-blue-400 cursor-pointer h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">읽음</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{inquiryStats.read}</p>
                  </div>
                  <div className="bg-blue-50 rounded-full p-2">
                    <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/mypage/inquiries')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-green-500 cursor-pointer h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">답변완료</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{inquiryStats.replied}</p>
                  </div>
                  <div className="bg-green-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 생산관리 통계 카드 */}
          <div className="mb-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">생산관리</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div 
                onClick={() => router.push('/production/list')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-blue-500 cursor-pointer h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">전체 요청</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{productionStats.totalRequests}</p>
                  </div>
                  <div className="bg-blue-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/production/list')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-yellow-500 cursor-pointer h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">검토 대기</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{productionStats.pendingReview}</p>
                  </div>
                  <div className="bg-yellow-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/production/list')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-green-500 cursor-pointer h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">계획 확정</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{productionStats.inProgress}</p>
                  </div>
                  <div className="bg-green-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/production/list')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-gray-500 cursor-pointer h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">생산 완료</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{productionStats.completed}</p>
                  </div>
                  <div className="bg-gray-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 성적서관리 통계 카드 */}
          <div className="mb-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">성적서관리</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div 
                onClick={() => router.push('/certificate/list')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-blue-500 cursor-pointer hover:shadow-lg transition-shadow h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">전체 요청</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{certificateStats.total}</p>
                  </div>
                  <div className="bg-blue-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/certificate/list')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-yellow-500 cursor-pointer hover:shadow-lg transition-shadow h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">대기중</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{certificateStats.pending}</p>
                  </div>
                  <div className="bg-yellow-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/certificate/list')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-blue-400 cursor-pointer hover:shadow-lg transition-shadow h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">진행중</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{certificateStats.inProgress}</p>
                  </div>
                  <div className="bg-blue-50 rounded-full p-2">
                    <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/certificate/list')}
                className="bg-white rounded-lg shadow-md p-4 border-l-4 border-green-500 cursor-pointer hover:shadow-lg transition-shadow h-full"
              >
                <div className="flex items-center justify-between h-full">
                  <div>
                    <p className="text-xs font-medium text-gray-600">완료</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{certificateStats.completed}</p>
                  </div>
                  <div className="bg-green-100 rounded-full p-2">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

