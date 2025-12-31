"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const ADMIN_SESSION_KEY = 'admin_session';

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

export default function AdminRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // 로그인 상태 확인
    const isAdmin = checkAdminAuth();
    
    if (isAdmin) {
      // 로그인 되어 있으면 dashboard로
      router.replace('/admin/dashboard');
    } else {
      // 로그인 안 되어 있으면 login으로
      router.replace('/admin/login');
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-600">리다이렉트 중...</p>
      </div>
    </div>
  );
}

