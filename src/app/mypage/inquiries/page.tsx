"use client";

import React, { useState, useEffect } from 'react';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Inquiry } from '@/types';
import { formatDateTime } from '@/lib/utils';

export default function MyInquiriesPage() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loadingInquiries, setLoadingInquiries] = useState(true);
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && userProfile) {
      loadMyInquiries();
    }
  }, [isAuthenticated, userProfile]);

  const loadMyInquiries = async () => {
    if (!userProfile) return;

    try {
      setLoadingInquiries(true);
      const inquiriesRef = collection(db, 'inquiries');
      // orderBy 제거하고 클라이언트 측에서 정렬
      const q = query(
        inquiriesRef,
        where('userId', '==', userProfile.id)
      );
      const querySnapshot = await getDocs(q);
      
      const inquiriesData: Inquiry[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        inquiriesData.push({
          id: doc.id,
          userId: data.userId,
          userName: data.userName,
          userEmail: data.userEmail,
          userCompany: data.userCompany,
          subject: data.subject,
          message: data.message,
          status: data.status || 'pending',
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          repliedAt: data.repliedAt?.toDate(),
          replyMessage: data.replyMessage,
          replyAttachments: data.replyAttachments || [],
        });
      });

      // 클라이언트 측에서 날짜순 정렬 (최신순)
      inquiriesData.sort((a, b) => {
        const dateA = a.createdAt.getTime();
        const dateB = b.createdAt.getTime();
        return dateB - dateA; // 내림차순
      });
      
      setInquiries(inquiriesData);
    } catch (error) {
      console.error('문의 목록 로드 오류:', error);
    } finally {
      setLoadingInquiries(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      pending: { label: '대기중', className: 'bg-yellow-100 text-yellow-800' },
      read: { label: '읽음', className: 'bg-blue-100 text-blue-800' },
      replied: { label: '답변완료', className: 'bg-green-100 text-green-800' },
    };
    
    const statusInfo = statusMap[status] || statusMap.pending;
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
    );
  };

  if (loading || loadingInquiries) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !userProfile) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">내 문의 내역</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={loadMyInquiries}
              disabled={loadingInquiries}
            >
              새로고침
            </Button>
          </div>

          {inquiries.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center">
              <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <p className="text-gray-500 mb-4">문의 내역이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {inquiries.map((inquiry) => (
                <div
                  key={inquiry.id}
                  className="bg-white rounded-lg shadow-sm p-6 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setSelectedInquiry(inquiry)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {inquiry.subject}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {formatDateTime(inquiry.createdAt)}
                      </p>
                    </div>
                    {getStatusBadge(inquiry.status)}
                  </div>
                  
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <p className="text-gray-900 whitespace-pre-wrap">
                      {inquiry.message}
                    </p>
                  </div>

                  {inquiry.replyMessage && (
                    <div className="border-t pt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h4 className="font-semibold text-gray-900">관리자 답변</h4>
                        {inquiry.repliedAt && (
                          <span className="text-xs text-gray-500">
                            ({formatDateTime(inquiry.repliedAt)})
                          </span>
                        )}
                      </div>
                      <div className="bg-blue-50 rounded-lg p-4 border-l-4 border-blue-500">
                        <p className="text-gray-900 whitespace-pre-wrap">
                          {inquiry.replyMessage}
                        </p>
                      </div>
                      {inquiry.replyAttachments && inquiry.replyAttachments.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-semibold text-gray-900 mb-2">답변 첨부 파일</h5>
                          <div className="space-y-2">
                            {inquiry.replyAttachments.map((attachment, index) => (
                              <a
                                key={index}
                                href={attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors"
                              >
                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{attachment.name}</p>
                                  <p className="text-xs text-gray-500">{attachment.size ? `${(attachment.size / 1024).toFixed(1)} KB` : ''}</p>
                                </div>
                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 상세 모달 */}
          {selectedInquiry && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-semibold text-gray-900">
                      {selectedInquiry.subject}
                    </h2>
                    <button
                      onClick={() => setSelectedInquiry(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="mb-6">
                    <p className="text-sm text-gray-500 mb-2">
                      문의일: {formatDateTime(selectedInquiry.createdAt)}
                    </p>
                    {getStatusBadge(selectedInquiry.status)}
                  </div>

                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-900 mb-2">문의 내용</h3>
                    <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap text-gray-900">
                      {selectedInquiry.message}
                    </div>
                  </div>

                  {selectedInquiry.replyMessage && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 className="font-semibold text-gray-900">관리자 답변</h3>
                        {selectedInquiry.repliedAt && (
                          <span className="text-sm text-gray-500">
                            ({formatDateTime(selectedInquiry.repliedAt)})
                          </span>
                        )}
                      </div>
                      <div className="bg-blue-50 rounded-lg p-4 border-l-4 border-blue-500 whitespace-pre-wrap text-gray-900">
                        {selectedInquiry.replyMessage}
                      </div>
                      {selectedInquiry.replyAttachments && selectedInquiry.replyAttachments.length > 0 && (
                        <div className="mt-4">
                          <h4 className="text-sm font-semibold text-gray-900 mb-2">답변 첨부 파일</h4>
                          <div className="space-y-2">
                            {selectedInquiry.replyAttachments.map((attachment, index) => (
                              <a
                                key={index}
                                href={attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors"
                              >
                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{attachment.name}</p>
                                  <p className="text-xs text-gray-500">{attachment.size ? `${(attachment.size / 1024).toFixed(1)} KB` : ''}</p>
                                </div>
                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={() => setSelectedInquiry(null)}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                    >
                      닫기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

