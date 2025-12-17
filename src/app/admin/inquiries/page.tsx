"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { collection, query, orderBy, getDocs, doc, updateDoc, Timestamp, onSnapshot, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from '@/lib/firebase';
import { Inquiry, InquiryAttachment } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { onAuthStateChanged } from 'firebase/auth';

const INQUIRY_TYPES = [
  { value: 'production', label: '생산 요청' },
  { value: 'certificate', label: '성적서 요청' },
  { value: 'account', label: '계정 관련' },
  { value: 'other', label: '기타' },
];

export default function AdminInquiriesPage() {
  const router = useRouter();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loadingInquiries, setLoadingInquiries] = useState(true);
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isFirebaseAuthenticated, setIsFirebaseAuthenticated] = useState(false);
  const [displayedInquiries, setDisplayedInquiries] = useState<Inquiry[]>([]);
  const [itemsPerPage] = useState(10); // 페이지당 표시할 문의 수
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    // 관리자 세션 확인 (localStorage 기반)
    const sessionData = localStorage.getItem('admin_session');
    if (!sessionData) {
      setError('관리자 세션이 없습니다. 다시 로그인해주세요.');
      setLoadingInquiries(false);
      return;
    }

    try {
      const session = JSON.parse(sessionData);
      const now = new Date().getTime();
      if (now > session.expiresAt) {
        setError('관리자 세션이 만료되었습니다. 다시 로그인해주세요.');
        setLoadingInquiries(false);
        return;
      }
    } catch {
      setError('관리자 세션이 유효하지 않습니다. 다시 로그인해주세요.');
      setLoadingInquiries(false);
      return;
    }

    // Firebase Auth 상태 확인 (선택사항, Firestore 접근을 위해)
    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      setIsFirebaseAuthenticated(!!user);
      // Firebase Auth 로그인 여부와 관계없이 문의 목록 로드 시도
      loadInquiries();
    });

    // 실시간으로 문의 목록 업데이트 (선택사항)
    const inquiriesRef = collection(db, 'inquiries');
    const q = query(inquiriesRef, orderBy('createdAt', 'desc'));
    const unsubscribeSnapshot = onSnapshot(
      q,
      (querySnapshot) => {
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
            attachments: data.attachments || [],
            replyAttachments: data.replyAttachments || [],
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            repliedAt: data.repliedAt?.toDate(),
            replyMessage: data.replyMessage,
          });
        });
        setInquiries(inquiriesData);
        setCurrentPage(1); // 목록 새로고침 시 첫 페이지로
        setLoadingInquiries(false);
      },
      (error) => {
        console.error('실시간 문의 목록 업데이트 오류:', error);
        // 실시간 업데이트 실패 시 일반 로드 시도
        loadInquiries();
      }
    );

    return () => {
      authUnsubscribe();
      unsubscribeSnapshot();
    };
  }, []);

  // 페이지네이션: 표시할 문의 목록 계산
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setDisplayedInquiries(inquiries.slice(startIndex, endIndex));
  }, [inquiries, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(inquiries.length / itemsPerPage);

  const loadInquiries = async () => {
    try {
      setLoadingInquiries(true);
      const inquiriesRef = collection(db, 'inquiries');
      const q = query(inquiriesRef, orderBy('createdAt', 'desc'));
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
          attachments: data.attachments || [],
          replyAttachments: data.replyAttachments || [],
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          repliedAt: data.repliedAt?.toDate(),
          replyMessage: data.replyMessage,
        });
      });
      
      setInquiries(inquiriesData);
    } catch (error) {
      console.error('문의 목록 로드 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      
      if (firebaseError.code === 'permission-denied') {
        if (!isFirebaseAuthenticated) {
          setError('Firestore 접근 권한이 없습니다. Firebase Console에서 보안 규칙을 확인하거나, 관리자용 Firebase 계정을 생성해주세요. 자세한 내용은 FIRESTORE_SECURITY_RULES.md 파일을 참고하세요.');
        } else {
          setError('Firestore 보안 규칙이 설정되지 않았거나 권한이 없습니다. Firebase Console에서 보안 규칙을 확인해주세요. 자세한 내용은 FIRESTORE_SECURITY_RULES.md 파일을 참고하세요.');
        }
      } else {
        setError(`문의 목록을 불러오는데 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
      }
    } finally {
      setLoadingInquiries(false);
    }
  };

  const handleInquiryClick = (inquiry: Inquiry) => {
    setSelectedInquiry(inquiry);
    setReplyMessage(inquiry.replyMessage || '');
    setReplyFiles([]);
    setError('');
    setSuccess('');
    
    // 읽음 상태로 변경 (아직 읽지 않은 경우)
    if (inquiry.status === 'pending') {
      markAsRead(inquiry.id);
    }
  };

  const handleReplyFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setReplyFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeReplyFile = (index: number) => {
    setReplyFiles(prev => prev.filter((_, i) => i !== index));
  };

  const markAsRead = async (inquiryId: string) => {
    try {
      await updateDoc(doc(db, 'inquiries', inquiryId), {
        status: 'read',
        updatedAt: Timestamp.now(),
      });
      // 실시간 업데이트가 활성화되어 있으면 자동으로 목록이 업데이트됨
    } catch (error) {
      console.error('상태 변경 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      if (firebaseError.code === 'permission-denied') {
        console.error('Firestore 보안 규칙이 설정되지 않았습니다.');
      }
    }
  };

  const handleReply = async () => {
    if (!selectedInquiry) return;
    
    if (!replyMessage.trim()) {
      setError('답변 내용을 입력해주세요.');
      return;
    }

    setReplying(true);
    setUploadingFiles(true);
    setError('');
    setSuccess('');

    try {
      let replyAttachments: InquiryAttachment[] = [];

      // 파일 업로드
      if (replyFiles.length > 0) {
        const uploadPromises = replyFiles.map(async (file) => {
          try {
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(2, 15);
            const fileName = `reply_${selectedInquiry.id}_${timestamp}_${randomId}_${file.name}`;
            const filePath = `inquiries/replies/${selectedInquiry.id}/${fileName}`;
            
            const storageRef = ref(storage, filePath);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);
            
            return {
              name: file.name,
              url: downloadURL,
              size: file.size,
              type: file.type,
            };
          } catch (fileError) {
            console.error(`파일 "${file.name}" 업로드 오류:`, fileError);
            throw fileError;
          }
        });

        replyAttachments = await Promise.all(uploadPromises);
      }

      // 기존 답변 첨부 파일이 있으면 유지
      const existingReplyAttachments = selectedInquiry.replyAttachments || [];
      const allReplyAttachments = [...existingReplyAttachments, ...replyAttachments];

      await updateDoc(doc(db, 'inquiries', selectedInquiry.id), {
        status: 'replied',
        replyMessage: replyMessage.trim(),
        replyAttachments: allReplyAttachments,
        repliedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      setSuccess('답변이 성공적으로 저장되었습니다.');
      setReplyFiles([]);
      loadInquiries(); // 목록 새로고침
      
      // 선택된 문의 정보 업데이트
      setSelectedInquiry({
        ...selectedInquiry,
        status: 'replied',
        replyMessage: replyMessage.trim(),
        replyAttachments: allReplyAttachments,
        repliedAt: new Date(),
      });
    } catch (error) {
      console.error('답변 저장 오류:', error);
      const firebaseError = error as { code?: string; message?: string };
      
      if (firebaseError.code === 'permission-denied') {
        setError('Firestore 보안 규칙이 설정되지 않았습니다. Firebase Console에서 보안 규칙을 설정해주세요.');
      } else {
        setError(`답변 저장에 실패했습니다: ${firebaseError.message || '알 수 없는 오류'}`);
      }
    } finally {
      setReplying(false);
      setUploadingFiles(false);
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

  if (loadingInquiries) {
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
            <h1 className="text-2xl font-bold text-gray-900">문의 관리</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={loadInquiries}
            >
              새로고침
            </Button>
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

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-sm font-medium">{success}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 문의 목록 */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-12rem)]">
                <div className="p-4 border-b border-gray-200 flex-shrink-0">
                  <h2 className="text-base font-semibold text-gray-900">
                    문의 목록 ({inquiries.length})
                  </h2>
                </div>
                <div className="flex flex-col flex-1 overflow-hidden">
                  <div className="divide-y divide-gray-200 flex-1 overflow-y-auto">
                    {inquiries.length === 0 ? (
                      <div className="p-4 text-center text-gray-500">
                        문의 내역이 없습니다.
                      </div>
                    ) : (
                      displayedInquiries.map((inquiry) => (
                        <button
                          key={inquiry.id}
                          onClick={() => handleInquiryClick(inquiry)}
                          className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                            selectedInquiry?.id === inquiry.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <h3 className="font-semibold text-gray-900 text-sm truncate flex-1">
                              {inquiry.subject}
                            </h3>
                            {getStatusBadge(inquiry.status)}
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                              {getTypeLabel(inquiry.type)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 mb-2">
                            {inquiry.userName} ({inquiry.userEmail})
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatDateTime(inquiry.createdAt)}
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
              </div>
            </div>

            {/* 문의 상세 및 답변 */}
            <div className="lg:col-span-2">
              {selectedInquiry ? (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 h-[calc(100vh-12rem)] overflow-y-auto">
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-semibold text-gray-900">
                        {selectedInquiry.subject}
                      </h2>
                      {getStatusBadge(selectedInquiry.status)}
                    </div>
                    
                    <div className="bg-gray-50 rounded-lg p-4 mb-4">
                      <div className="space-y-2 text-sm">
                        <div className="flex">
                          <span className="font-medium text-gray-700 w-20">문의 유형:</span>
                          <span className="text-gray-900">{getTypeLabel(selectedInquiry.type)}</span>
                        </div>
                        <div className="flex">
                          <span className="font-medium text-gray-700 w-20">문의자:</span>
                          <span className="text-gray-900">{selectedInquiry.userName}</span>
                        </div>
                        <div className="flex">
                          <span className="font-medium text-gray-700 w-20">이메일:</span>
                          <span className="text-gray-900">{selectedInquiry.userEmail}</span>
                        </div>
                        {selectedInquiry.userCompany && (
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-20">회사:</span>
                            <span className="text-gray-900">{selectedInquiry.userCompany}</span>
                          </div>
                        )}
                        <div className="flex">
                          <span className="font-medium text-gray-700 w-20">문의일:</span>
                          <span className="text-gray-900">{formatDateTime(selectedInquiry.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mb-6">
                      <h3 className="font-semibold text-gray-900 mb-2">문의 내용</h3>
                      <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap text-gray-900">
                        {selectedInquiry.message}
                      </div>
                      
                      {selectedInquiry.attachments && selectedInquiry.attachments.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-semibold text-gray-900 mb-2">첨부 파일</h4>
                          <div className="space-y-2">
                            {selectedInquiry.attachments.map((attachment, index) => (
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

                    {selectedInquiry.replyMessage ? (
                      <div className="mb-6">
                        <h3 className="font-semibold text-gray-900 mb-2">답변 내용</h3>
                        <div className="bg-blue-50 rounded-lg p-4 whitespace-pre-wrap text-gray-900 border-l-4 border-blue-500">
                          {selectedInquiry.replyMessage}
                        </div>
                        {selectedInquiry.repliedAt && (
                          <p className="text-xs text-gray-500 mt-2">
                            답변일: {formatDateTime(selectedInquiry.repliedAt)}
                          </p>
                        )}
                        {selectedInquiry.replyAttachments && selectedInquiry.replyAttachments.length > 0 && (
                          <div className="mt-4">
                            <h4 className="font-semibold text-gray-900 mb-2">답변 첨부 파일</h4>
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
                    ) : (
                      <div className="mb-6">
                        <label htmlFor="reply" className="block text-sm font-medium text-gray-700 mb-2">
                          답변 작성
                        </label>
                        <textarea
                          id="reply"
                          rows={6}
                          value={replyMessage}
                          onChange={(e) => setReplyMessage(e.target.value)}
                          placeholder="답변 내용을 입력하세요..."
                          className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <div className="mt-4">
                          <label htmlFor="replyFiles" className="block text-sm font-medium text-gray-700 mb-2">
                            첨부 파일
                          </label>
                          <input
                            id="replyFiles"
                            type="file"
                            multiple
                            onChange={handleReplyFileChange}
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                            disabled={replying || uploadingFiles}
                          />
                          {replyFiles.length > 0 && (
                            <div className="mt-2 space-y-2">
                              {replyFiles.map((file, index) => (
                                <div key={index} className="flex items-center justify-between bg-gray-50 rounded-lg p-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <span className="text-sm text-gray-900 truncate">{file.name}</span>
                                    <span className="text-xs text-gray-500">({(file.size / 1024).toFixed(1)} KB)</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeReplyFile(index)}
                                    className="text-red-500 hover:text-red-700 ml-2"
                                    disabled={replying || uploadingFiles}
                                  >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-3">
                      <Button
                        variant="outline"
                        size="md"
                        onClick={() => {
                          setSelectedInquiry(null);
                          setReplyMessage('');
                          setReplyFiles([]);
                          setError('');
                          setSuccess('');
                        }}
                        disabled={replying}
                      >
                        닫기
                      </Button>
                      {!selectedInquiry.replyMessage && (
                        <Button
                          variant="primary"
                          size="md"
                          onClick={handleReply}
                          loading={replying || uploadingFiles}
                          disabled={replying || uploadingFiles}
                        >
                          {uploadingFiles ? '파일 업로드 중...' : '답변 저장'}
                        </Button>
                      )}
                  </div>
                </div>
              </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center h-[calc(100vh-12rem)] flex items-center justify-center">
                  <div>
                    <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    <p className="text-gray-500">문의를 선택하면 상세 내용과 답변을 작성할 수 있습니다.</p>
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

