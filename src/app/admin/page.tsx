"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { collection, query, where, onSnapshot, getDocs, orderBy, limit } from 'firebase/firestore';
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
  const [pendingUserCount, setPendingUserCount] = useState(0);
  const [pendingInquiryCount, setPendingInquiryCount] = useState(0);
  const [productionRequestCount, setProductionRequestCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 인증 체크 먼저 수행
    const isAdmin = checkAdminAuth();
    
    if (!isAdmin) {
      // 인증되지 않으면 로그인 페이지로 리다이렉트
      router.replace('/admin/login');
      return;
    }

    // 초기 로딩 상태 해제
    setLoading(false);

    // 승인 대기 회원 수 구독
    const usersRef = collection(db, 'users');
    const usersQuery = query(usersRef, where('approved', '==', false));
    const unsubscribeUsers = onSnapshot(
      usersQuery,
      (snapshot) => {
        setPendingUserCount(snapshot.size);
      },
      (error) => {
        console.error('승인 대기 회원 수 조회 오류:', error);
      }
    );

    // 대기 중인 문의 수 구독 (인덱스 없이 작동하도록 orderBy 제거)
    const inquiriesRef = collection(db, 'inquiries');
    const inquiriesQuery = query(inquiriesRef, where('status', '==', 'pending'));
    const unsubscribeInquiries = onSnapshot(
      inquiriesQuery,
      (snapshot) => {
        setPendingInquiryCount(snapshot.size);
      },
      (error) => {
        console.error('대기 중인 문의 수 조회 오류:', error);
      }
    );

    // 생산 요청 수 조회
    const productionRequestsRef = collection(db, 'productionRequests');
    getDocs(productionRequestsRef)
      .then((snapshot) => {
        setProductionRequestCount(snapshot.size);
      })
      .catch((error) => {
        console.error('생산 요청 수 조회 오류:', error);
      });

    return () => {
      unsubscribeUsers();
      unsubscribeInquiries();
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
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">관리자 대시보드</h1>
        <p className="text-gray-600 mt-1">시스템 현황을 한눈에 확인하세요</p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* 승인 대기 회원 */}
        <Link href="/admin/users" className="block">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">승인 대기 회원</p>
                <p className="text-3xl font-bold text-gray-900">{pendingUserCount}</p>
              </div>
              <div className="bg-orange-100 rounded-full p-3">
                <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm text-blue-600">
              <span>회원 관리로 이동</span>
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </Link>

        {/* 대기 중인 문의 */}
        <Link href="/admin/inquiries" className="block">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">대기 중인 문의</p>
                <p className="text-3xl font-bold text-gray-900">{pendingInquiryCount}</p>
              </div>
              <div className="bg-blue-100 rounded-full p-3">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm text-blue-600">
              <span>문의 관리로 이동</span>
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </Link>

        {/* 생산 요청 */}
        <Link href="/admin/production" className="block">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">생산 요청</p>
                <p className="text-3xl font-bold text-gray-900">{productionRequestCount}</p>
              </div>
              <div className="bg-green-100 rounded-full p-3">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm text-blue-600">
              <span>생산관리로 이동</span>
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </Link>
      </div>

      {/* 빠른 링크 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">빠른 링크</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/admin/users"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <div>
              <p className="font-medium text-gray-900">회원 관리</p>
              <p className="text-sm text-gray-600">회원 승인 및 관리</p>
            </div>
          </Link>

          <Link
            href="/admin/inquiries"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <div>
              <p className="font-medium text-gray-900">문의 관리</p>
              <p className="text-sm text-gray-600">문의 답변 및 관리</p>
            </div>
          </Link>

          <Link
            href="/admin/production"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
            <div>
              <p className="font-medium text-gray-900">생산관리</p>
              <p className="text-sm text-gray-600">생산 요청 및 일정 관리</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

