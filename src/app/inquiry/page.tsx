"use client";

import React, { useState, useEffect } from 'react';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { collection, addDoc, query, where, orderBy, getDocs, Timestamp, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Inquiry } from '@/types';
import { formatDateTime } from '@/lib/utils';

type TabType = 'new' | 'history';

const INQUIRY_TYPES = [
  { value: 'production', label: '생산 요청' },
  { value: 'account', label: '계정 관련' },
  { value: 'other', label: '기타' },
];

export default function InquiryPage() {
  const { isAuthenticated, userProfile, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('new');
  const [formData, setFormData] = useState({
    type: 'production',
    subject: '',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loadingInquiries, setLoadingInquiries] = useState(false);
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [displayedInquiries, setDisplayedInquiries] = useState<Inquiry[]>([]);
  const [itemsPerPage] = useState(10); // 페이지당 표시할 문의 수
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (activeTab === 'history' && isAuthenticated && userProfile) {
      loadMyInquiries();
    }
  }, [activeTab, isAuthenticated, userProfile]);

  // 페이지네이션: 표시할 문의 목록 계산
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setDisplayedInquiries(inquiries.slice(startIndex, endIndex));
  }, [inquiries, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(inquiries.length / itemsPerPage);

  const loadMyInquiries = async () => {
    if (!userProfile) return;

    try {
      setLoadingInquiries(true);
      const inquiriesRef = collection(db, 'inquiries');
      // 인덱스 없이 사용하기 위해 orderBy 제거하고 클라이언트 측에서 정렬
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
          type: data.type,
          subject: data.subject,
          message: data.message,
          status: data.status || 'pending',
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          repliedAt: data.repliedAt?.toDate(),
          replyMessage: data.replyMessage,
        });
      });
      
      // 클라이언트 측에서 날짜순 정렬 (최신순)
      inquiriesData.sort((a, b) => {
        const dateA = a.createdAt.getTime();
        const dateB = b.createdAt.getTime();
        return dateB - dateA; // 내림차순
      });
      
      setInquiries(inquiriesData);
      setCurrentPage(1); // 목록 새로고침 시 첫 페이지로
    } catch (error) {
      console.error('문의 목록 로드 오류:', error);
    } finally {
      setLoadingInquiries(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
    if (error) setError('');
    if (success) setSuccess('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    if (!formData.subject.trim()) {
      setError('제목을 입력해주세요.');
      setSubmitting(false);
      return;
    }

    if (!formData.message.trim()) {
      setError('문의 내용을 입력해주세요.');
      setSubmitting(false);
      return;
    }

    try {
      if (!userProfile) {
        setError('사용자 정보를 불러올 수 없습니다. 다시 로그인해주세요.');
        setSubmitting(false);
        return;
      }

      // Firestore에 문의 내용 저장
      const now = Timestamp.now();
      await addDoc(collection(db, 'inquiries'), {
        userId: userProfile.id,
        userName: userProfile.name,
        userEmail: userProfile.email,
        userCompany: userProfile.company || '',
        type: formData.type,
        subject: formData.subject.trim(),
        message: formData.message.trim(),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });

      setFormData({ type: 'production', subject: '', message: '' });
      
      // 내 문의 내역 탭으로 전환하고 목록 새로고침
      // 성공 메시지는 표시하지 않음 (답변이 완료된 문의를 볼 때 불필요)
      setActiveTab('history');
      setSuccess(''); // 성공 메시지 초기화
      
      loadMyInquiries();
    } catch (error) {
      console.error('문의하기 오류:', error);
      setError('문의 전송에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
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

  const getTypeLabel = (type?: string) => {
    const typeOption = INQUIRY_TYPES.find(t => t.value === type);
    return typeOption?.label || '기타';
  };

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

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">문의하기</h1>
          <p className="text-gray-600 mb-8">서비스 이용 중 궁금한 점이나 문제가 있으시면 문의해주세요</p>

          {/* 탭 메뉴 */}
          <div className="flex items-center justify-between border-b border-gray-200 mb-6">
            <div className="flex">
              <button
                onClick={() => {
                  setActiveTab('new');
                  setSuccess(''); // 탭 전환 시 성공 메시지 초기화
                }}
                className={`px-6 py-3 font-medium text-sm transition-colors ${
                  activeTab === 'new'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                새 문의 작성
              </button>
              <button
                onClick={() => {
                  setActiveTab('history');
                  setSuccess(''); // 탭 전환 시 성공 메시지 초기화
                }}
                className={`px-6 py-3 font-medium text-sm transition-colors ${
                  activeTab === 'history'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                내 문의 내역
              </button>
            </div>
            {activeTab === 'history' && (
              <Button
                variant="outline"
                size="sm"
                onClick={loadMyInquiries}
                disabled={loadingInquiries}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                새로고침
              </Button>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border-2 border-red-400 text-red-800 px-6 py-4 rounded-lg shadow-md mb-6">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="font-semibold">{error}</p>
              </div>
            </div>
          )}

          {/* 성공 메시지는 표시하지 않음 (문의 제출 후 내 문의 내역 탭으로 전환) */}

          {/* 새 문의 작성 탭 */}
          {activeTab === 'new' && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-1">
                    문의 유형 <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="type"
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    required
                    className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {INQUIRY_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <Input
                  id="subject"
                  name="subject"
                  type="text"
                  label="제목"
                  required
                  value={formData.subject}
                  onChange={handleChange}
                  placeholder="문의 제목을 입력해주세요"
                />

                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
                    내용 <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={8}
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="문의 내용을 자세히 입력해주세요"
                    required
                    className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    loading={submitting}
                  >
                    문의하기
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* 내 문의 내역 탭 */}
          {activeTab === 'history' && (
            <div>
              {loadingInquiries ? (
                <div className="bg-white rounded-lg shadow-sm p-12 text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">로딩 중...</p>
                </div>
              ) : inquiries.length === 0 ? (
                <div className="bg-white rounded-lg shadow-sm p-12 text-center">
                  <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <p className="text-gray-500">문의 내역이 없습니다.</p>
                </div>
              ) : (
                <div>
                  <div className="space-y-4 mb-6">
                    {displayedInquiries.map((inquiry) => (
                    <div
                      key={inquiry.id}
                      className="bg-white rounded-lg shadow-sm p-6 cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => setSelectedInquiry(inquiry)}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                              {getTypeLabel(inquiry.type)}
                            </span>
                            {getStatusBadge(inquiry.status)}
                          </div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {inquiry.subject}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {formatDateTime(inquiry.createdAt)}
                          </p>
                        </div>
                      </div>
                      
                      <div className="bg-gray-50 rounded-lg p-4 mb-4">
                        <p className="text-gray-900 whitespace-pre-wrap line-clamp-3">
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
                            <p className="text-gray-900 whitespace-pre-wrap line-clamp-2">
                              {inquiry.replyMessage}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  </div>
                  
                  {/* 페이지네이션 */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-6">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                      >
                        이전
                      </Button>
                      <span className="text-sm text-gray-600">
                        {currentPage} / {totalPages} (전체 {inquiries.length}개)
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
              )}
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
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                        {getTypeLabel(selectedInquiry.type)}
                      </span>
                      {getStatusBadge(selectedInquiry.status)}
                    </div>
                    <p className="text-sm text-gray-500">
                      문의일: {formatDateTime(selectedInquiry.createdAt)}
                    </p>
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
