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
  const [loadingStats, setLoadingStats] = useState(true);

  // 인증 확인 및 리다이렉트
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

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
      
      // 생산요청 통계
      const requestsRef = collection(db, 'productionRequests');
      const myRequestsQuery = query(
        requestsRef,
        where('userId', '==', userProfile.id)
      );
      const requestsSnapshot = await getDocs(myRequestsQuery);
      
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div 
                onClick={() => router.push('/mypage/inquiries')}
                className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">전체 문의</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{inquiryStats.totalInquiries}</p>
                  </div>
                  <div className="bg-blue-100 rounded-full p-3">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/mypage/inquiries')}
                className="bg-white rounded-lg shadow-md p-6 border-l-4 border-yellow-500 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">대기중</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{inquiryStats.pending}</p>
                  </div>
                  <div className="bg-yellow-100 rounded-full p-3">
                    <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/mypage/inquiries')}
                className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-400 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">읽음</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{inquiryStats.read}</p>
                  </div>
                  <div className="bg-blue-50 rounded-full p-3">
                    <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/mypage/inquiries')}
                className="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-500 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">답변완료</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{inquiryStats.replied}</p>
                  </div>
                  <div className="bg-green-100 rounded-full p-3">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div 
                onClick={() => router.push('/production/list')}
                className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">전체 요청</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{productionStats.totalRequests}</p>
                  </div>
                  <div className="bg-blue-100 rounded-full p-3">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/production/list')}
                className="bg-white rounded-lg shadow-md p-6 border-l-4 border-yellow-500 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">검토 대기</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{productionStats.pendingReview}</p>
                  </div>
                  <div className="bg-yellow-100 rounded-full p-3">
                    <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/production/list')}
                className="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-500 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">생산 중</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{productionStats.inProgress}</p>
                  </div>
                  <div className="bg-green-100 rounded-full p-3">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => router.push('/production/list')}
                className="bg-white rounded-lg shadow-md p-6 border-l-4 border-gray-500 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">생산 완료</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{productionStats.completed}</p>
                  </div>
                  <div className="bg-gray-100 rounded-full p-3">
                    <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

