"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, orderBy, getDocs, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { User } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui';

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

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [displayedUsers, setDisplayedUsers] = useState<User[]>([]);
  const [itemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    // 관리자 세션 확인
    if (!checkAdminAuth()) {
      router.push('/admin/login');
      return;
    }

    // 실시간 사용자 목록 구독
    const usersRef = collection(db, 'users');
    const q = query(usersRef, orderBy('createdAt', 'desc'));
    
    const unsubscribeSnapshot = onSnapshot(
      q,
      (querySnapshot) => {
        const usersData: User[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          usersData.push({
            id: doc.id,
            name: data.name || '',
            email: data.email || '',
            company: data.company,
            position: data.position,
            phone: data.phone,
            address: data.address,
            businessNumber: data.businessNumber,
            website: data.website,
            userTypes: data.userTypes || [],
            currentRole: data.currentRole,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            deleted: data.deleted || false,
            deletedAt: data.deletedAt?.toDate(),
            deletedBy: data.deletedBy,
          });
        });
        setUsers(usersData);
        setCurrentPage(1);
        setLoadingUsers(false);
      },
      (error) => {
        console.error('실시간 사용자 목록 업데이트 오류:', error);
        setError('사용자 목록을 불러오는데 실패했습니다.');
        setLoadingUsers(false);
      }
    );

    return () => {
      unsubscribeSnapshot();
    };
  }, [router]);

  // 페이지네이션: 표시할 사용자 목록 계산
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setDisplayedUsers(users.slice(startIndex, endIndex));
  }, [users, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(users.length / itemsPerPage);

  const handleUserClick = (user: User) => {
    setSelectedUser(user);
  };

  if (loadingUsers) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">회원 관리</h1>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-medium">{error}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 회원 목록 */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-12rem)]">
                <div className="p-4 border-b border-gray-200 flex-shrink-0">
                  <h2 className="text-base font-semibold text-gray-900">
                    회원 목록 ({users.length})
                  </h2>
                </div>
                <div className="flex flex-col flex-1 overflow-hidden">
                  <div className="divide-y divide-gray-200 flex-1 overflow-y-auto">
                    {users.length === 0 ? (
                      <div className="p-4 text-center text-gray-500">
                        등록된 회원이 없습니다.
                      </div>
                    ) : (
                      displayedUsers.map((user) => (
                        <button
                          key={user.id}
                          onClick={() => handleUserClick(user)}
                          className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                            selectedUser?.id === user.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <h3 className="font-semibold text-gray-900 text-sm truncate flex-1">
                              {user.name}
                            </h3>
                            {user.deleted && (
                              <span className="text-xs text-red-600 bg-red-100 px-2 py-0.5 rounded">
                                삭제됨
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 mb-1 truncate">
                            {user.email}
                          </p>
                          {user.company && (
                            <p className="text-xs text-gray-500 mb-1 truncate">
                              {user.company}
                            </p>
                          )}
                          <p className="text-xs text-gray-500">
                            가입일: {formatDateTime(user.createdAt)}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                  
                  {/* 페이지네이션 */}
                  {totalPages > 1 && (
                    <div className="p-4 border-t border-gray-200 flex items-center justify-center gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                      >
                        이전
                      </Button>
                      <span className="text-xs text-gray-600">
                        {currentPage} / {totalPages} (전체 {users.length}개)
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                      >
                        다음
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 회원 상세 정보 */}
            <div className="lg:col-span-2">
              {selectedUser ? (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 h-[calc(100vh-12rem)] overflow-y-auto">
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-semibold text-gray-900">
                        {selectedUser.name}
                      </h2>
                      {selectedUser.deleted && (
                        <span className="text-sm text-red-600 bg-red-100 px-3 py-1 rounded">
                          삭제된 회원
                        </span>
                      )}
                    </div>
                    
                    <div className="bg-gray-50 rounded-lg p-4 mb-4">
                      <div className="space-y-3 text-sm">
                        <div className="flex">
                          <span className="font-medium text-gray-700 w-32 flex-shrink-0">이름:</span>
                          <span className="text-gray-900">{selectedUser.name}</span>
                        </div>
                        <div className="flex">
                          <span className="font-medium text-gray-700 w-32 flex-shrink-0">이메일:</span>
                          <span className="text-gray-900">{selectedUser.email}</span>
                        </div>
                        {selectedUser.company && (
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-32 flex-shrink-0">회사:</span>
                            <span className="text-gray-900">{selectedUser.company}</span>
                          </div>
                        )}
                        {selectedUser.position && (
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-32 flex-shrink-0">직책:</span>
                            <span className="text-gray-900">{selectedUser.position}</span>
                          </div>
                        )}
                        {selectedUser.phone && (
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-32 flex-shrink-0">핸드폰 번호:</span>
                            <span className="text-gray-900">{selectedUser.phone}</span>
                          </div>
                        )}
                        {selectedUser.businessNumber && (
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-32 flex-shrink-0 whitespace-nowrap">사업자 등록번호:</span>
                            <span className="text-gray-900 whitespace-nowrap">
                              {selectedUser.businessNumber.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3')}
                            </span>
                          </div>
                        )}
                        {selectedUser.address && (
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-32 flex-shrink-0">주소:</span>
                            <span className="text-gray-900">{selectedUser.address}</span>
                          </div>
                        )}
                        {selectedUser.website && (
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-32 flex-shrink-0">웹사이트:</span>
                            <span className="text-gray-900">
                              <a href={selectedUser.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                {selectedUser.website}
                              </a>
                            </span>
                          </div>
                        )}
                        <div className="flex">
                          <span className="font-medium text-gray-700 w-32 flex-shrink-0">가입일:</span>
                          <span className="text-gray-900">{formatDateTime(selectedUser.createdAt)}</span>
                        </div>
                        <div className="flex">
                          <span className="font-medium text-gray-700 w-32 flex-shrink-0">수정일:</span>
                          <span className="text-gray-900">{formatDateTime(selectedUser.updatedAt)}</span>
                        </div>
                        {selectedUser.deletedAt && (
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-32 flex-shrink-0">삭제일:</span>
                            <span className="text-gray-900">{formatDateTime(selectedUser.deletedAt)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button
                      variant="outline"
                      size="md"
                      onClick={() => {
                        setSelectedUser(null);
                      }}
                    >
                      닫기
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center h-[calc(100vh-12rem)] flex items-center justify-center">
                  <div>
                    <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <p className="text-gray-500">회원을 선택하면 상세 정보를 확인할 수 있습니다.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

