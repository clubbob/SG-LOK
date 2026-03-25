"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { db, storage } from '@/lib/firebase';
import { Notice, NoticeAttachment } from '@/types';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, Timestamp, addDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Button } from '@/components/ui';

const MAX_ATTACHMENTS = 3;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date();
};

const toNoticeAttachment = (att: unknown): NoticeAttachment | null => {
  if (!att || typeof att !== 'object') return null;
  const a = att as Partial<NoticeAttachment> & Record<string, unknown>;
  if (typeof a.name !== 'string' || typeof a.url !== 'string' || typeof a.size !== 'number' || typeof a.type !== 'string') return null;
  return {
    name: a.name,
    url: a.url,
    storagePath: typeof a.storagePath === 'string' ? a.storagePath : null,
    size: a.size,
    type: a.type,
    uploadedAt: toDate(a.uploadedAt),
    uploadedBy: typeof a.uploadedBy === 'string' ? a.uploadedBy : 'admin',
  };
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

type ModalMode = 'create' | 'edit';

export default function AdminNoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 기존 관리자 작업(생산요청/성적서)에서 Firestore에 저장하는 값과 동일하게 유지합니다.
  // (보안 규칙이 request.resource.data.* === 'admin' 형태로 작성되어 있을 수 있음)
  const ADMIN_USER_ID = 'admin';

  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<NoticeAttachment[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removedStoragePaths, setRemovedStoragePaths] = useState<Set<string>>(new Set());

  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  type FilterTab = 'all' | 'pinned' | 'published' | 'draft';
  const [filterTab, setFilterTab] = useState<FilterTab>('all');

  const [pinned, setPinned] = useState(false);
  const [published, setPublished] = useState(true);
  const [createdByInput, setCreatedByInput] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    const load = () => {
      try {
        setLoading(true);
        const noticesRef = collection(db, 'notices');
        const q = query(noticesRef, orderBy('createdAt', 'desc'));
        return onSnapshot(
          q,
          (snap) => {
            if (!mounted) return;
            const items: Notice[] = [];
            snap.forEach((docSnap) => {
              const data = docSnap.data() as Record<string, unknown>;
              const attachmentsRaw = Array.isArray(data.attachments) ? data.attachments : [];
              const mappedAttachments = attachmentsRaw
                .map((x) => toNoticeAttachment(x))
                .filter((x): x is NoticeAttachment => x !== null);

              const noticePinned = typeof data.pinned === 'boolean' ? data.pinned : false;
              const noticePublished = typeof data.published === 'boolean' ? data.published : true;

              items.push({
                id: docSnap.id,
                title: typeof data.title === 'string' ? data.title : '',
                content: typeof data.content === 'string' ? data.content : '',
                attachments: mappedAttachments,
                createdAt: toDate(data.createdAt),
                updatedAt: toDate(data.updatedAt ?? data.createdAt),
                createdBy: typeof data.createdBy === 'string' ? data.createdBy : ADMIN_USER_ID,
                updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
                pinned: noticePinned,
                published: noticePublished,
              });
            });
            setNotices(items);
            setLoading(false);
          },
          (e) => {
            console.error('공지사항 목록 로드 오류:', e);
            if (mounted) {
              setError('공지사항을 불러오지 못했습니다.');
              setLoading(false);
            }
          }
        );
      } catch (e) {
        console.error(e);
        if (mounted) {
          setError('공지사항 로드에 실패했습니다.');
          setLoading(false);
        }
        return () => {};
      }
    };
    const unsub = load();
    return () => {
      mounted = false;
      if (typeof unsub === 'function') {
        unsub();
      }
    };
  }, []);

  const openCreateModal = () => {
    setModalMode('create');
    setEditingId(null);
    setTitle('');
    setContent('');
    setAttachments([]);
    setNewFiles([]);
    setRemovedStoragePaths(new Set());
    setFormError('');
    setPinned(false);
    setPublished(true);
    setCreatedByInput('');
    setIsModalOpen(true);
  };

  const openEditModal = (n: Notice) => {
    setModalMode('edit');
    setEditingId(n.id);
    setTitle(n.title);
    setContent(n.content);
    setAttachments(n.attachments);
    setNewFiles([]);
    setRemovedStoragePaths(new Set());
    setFormError('');
    setPinned(n.pinned ?? false);
    setPublished(n.published ?? true);
    setCreatedByInput(n.createdBy || '');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setIsModalOpen(false);
  };

  const handleNewFilesAdd = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    setFormError('');

    const totalCount = (modalMode === 'edit' ? attachments.length : 0) + newFiles.length + fileArr.length;
    if (totalCount > MAX_ATTACHMENTS) {
      setFormError(`첨부는 최대 ${MAX_ATTACHMENTS}개까지 가능합니다.`);
      return;
    }

    const oversized = fileArr.filter((f) => f.size > MAX_SIZE_BYTES);
    if (oversized.length > 0) {
      setFormError(`첨부 파일 크기는 각 ${formatFileSize(MAX_SIZE_BYTES)} 이하로 제한됩니다.`);
      return;
    }

    setNewFiles((prev) => [...prev, ...fileArr]);
  };

  const removeNewFileAt = (idx: number) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeExistingAttachmentAt = (idx: number) => {
    const removed = attachments[idx];
    if (removed?.storagePath) {
      setRemovedStoragePaths((prev) => new Set(prev).add(removed.storagePath as string));
    }
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setFormError('');
    if (!title.trim()) {
      setFormError('제목을 입력해주세요.');
      return;
    }
    if (!content.trim()) {
      setFormError('내용을 입력해주세요.');
      return;
    }
    if (!createdByInput.trim()) {
      setFormError('등록자를 입력해주세요.');
      return;
    }

    setSaving(true);
    try {
      if (modalMode === 'create') {
        const authorId = createdByInput.trim();
        const docRef = await addDoc(collection(db, 'notices'), {
          title: title.trim(),
          content: content.trim(),
          pinned,
          published,
          attachments: [],
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: authorId,
          updatedBy: authorId,
        });

        const uploadedAttachments: NoticeAttachment[] = [];
        for (let i = 0; i < newFiles.length; i++) {
          const file = newFiles[i];
          const fileName = `attachment_${i + 1}_${file.name}`;
          const filePath = `notices/${docRef.id}/attachments/${fileName}`;
          const storageRef = ref(storage, filePath);
          await uploadBytes(storageRef, file);
          const downloadURL = await getDownloadURL(storageRef);

          uploadedAttachments.push({
            name: file.name,
            url: downloadURL,
            storagePath: filePath,
            size: file.size,
            type: file.type,
            uploadedAt: new Date(),
            uploadedBy: ADMIN_USER_ID,
          });
        }

        await updateDoc(docRef, {
          attachments: uploadedAttachments,
          updatedAt: Timestamp.now(),
          updatedBy: authorId,
        });
      } else {
        if (!editingId) throw new Error('수정할 공지사항이 없습니다.');
        const authorId = createdByInput.trim();
        const docRef = doc(db, 'notices', editingId);

        // 삭제 처리
        const removedPaths = Array.from(removedStoragePaths);
        for (const p of removedPaths) {
          if (!p) continue;
          try {
            await deleteObject(ref(storage, p));
          } catch (e) {
            console.warn('첨부 삭제 실패:', p, e);
          }
        }

        // 새 업로드 처리
        const uploadedAttachments: NoticeAttachment[] = [];
        for (let i = 0; i < newFiles.length; i++) {
          const file = newFiles[i];
          const fileName = `attachment_${attachments.length + i + 1}_${file.name}`;
          const filePath = `notices/${editingId}/attachments/${fileName}`;
          const storageRef = ref(storage, filePath);
          await uploadBytes(storageRef, file);
          const downloadURL = await getDownloadURL(storageRef);

          uploadedAttachments.push({
            name: file.name,
            url: downloadURL,
            storagePath: filePath,
            size: file.size,
            type: file.type,
            uploadedAt: new Date(),
            uploadedBy: ADMIN_USER_ID,
          });
        }

        const finalAttachments = [...attachments, ...uploadedAttachments].slice(0, MAX_ATTACHMENTS);

        await updateDoc(docRef, {
          title: title.trim(),
          content: content.trim(),
          pinned,
          published,
          attachments: finalAttachments,
          updatedAt: Timestamp.now(),
          updatedBy: authorId,
        });
      }

      setIsModalOpen(false);
    } catch (e) {
      console.error('공지사항 저장 오류:', e);
      setFormError('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (n: Notice) => {
    if (!confirm('정말로 이 공지사항을 삭제하시겠습니까?')) return;
    setError('');
    try {
      // 첨부 먼저 삭제
      for (const att of n.attachments) {
        if (!att.storagePath) continue;
        try {
          await deleteObject(ref(storage, att.storagePath));
        } catch (e) {
          console.warn('첨부 삭제 실패:', att.storagePath, e);
        }
      }
      await deleteDoc(doc(db, 'notices', n.id));
    } catch (e) {
      console.error('공지사항 삭제 오류:', e);
      setError('삭제에 실패했습니다.');
    }
  };

  const attachmentCountText = (atts: NoticeAttachment[]) => `${atts.length}/${MAX_ATTACHMENTS}`;

  const displayedNotices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return [...notices]
      .filter((n) => {
        if (filterTab === 'pinned') return n.pinned === true;
        if (filterTab === 'published') return n.published !== false;
        if (filterTab === 'draft') return n.published === false;
        return true;
      })
      .filter((n) => {
        if (!q) return true;
        return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const pinA = a.pinned ? 1 : 0;
        const pinB = b.pinned ? 1 : 0;
        if (pinA !== pinB) return pinB - pinA;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }, [notices, searchQuery, filterTab]);

  const currentAttachmentCount = (modalMode === 'edit' ? attachments.length : 0) + newFiles.length;
  const remainingAttachments = Math.max(0, MAX_ATTACHMENTS - currentAttachmentCount);
  const isAttachmentMaxed = remainingAttachments === 0;

  // "최근일수록 번호가 더 뒤"가 되도록 createdAt 오름차순 기준으로 번호를 매깁니다.
  const noticeNumberMap = useMemo(() => {
    const asc = [...displayedNotices].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const map: Record<string, number> = {};
    asc.forEach((n, i) => {
      map[n.id] = i + 1;
    });
    return map;
  }, [displayedNotices]);

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">공지사항</h1>
          <p className="text-gray-600 mt-2">고정/게시 상태를 포함해 공지사항을 관리합니다.</p>
        </div>
        <div className="flex gap-3 shrink-0">
          <Button variant="primary" size="sm" onClick={openCreateModal} disabled={loading}>
            + 등록
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              filterTab === 'all'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('pinned')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              filterTab === 'pinned'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            고정
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('published')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              filterTab === 'published'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            바로 게시
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('draft')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              filterTab === 'draft'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            미게시
          </button>
        </div>

        <div className="w-full sm:w-[360px]">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="공지 검색 (제목/내용)"
            className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-2 border-red-400 text-red-800 px-6 py-4 rounded-lg shadow-md mb-6">
          <p className="font-semibold">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-gray-500">로딩 중...</div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">번호</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">등록자</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">제목</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">등록일</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">첨부</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {displayedNotices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      {searchQuery.trim() ? '검색 결과가 없습니다.' : '등록된 공지사항이 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  displayedNotices.map((n) => (
                    <tr key={n.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">{noticeNumberMap[n.id] ?? '-'}</td>
                      <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">{n.createdBy}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {n.pinned && (
                            <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-[11px] font-semibold">
                              고정
                            </span>
                          )}
                          {n.published === false ? (
                            <span className="inline-flex items-center rounded-full bg-gray-50 text-gray-700 px-2 py-0.5 text-[11px] font-semibold border border-gray-200">
                              미게시
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-[11px] font-semibold border border-green-100">
                              게시중
                            </span>
                          )}
                          <Link
                            href={`/admin/notices/${n.id}`}
                            className="font-medium text-blue-700 hover:text-blue-800 truncate max-w-[260px] inline-block"
                          >
                            {n.title}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">{toDate(n.createdAt).toISOString().slice(0, 10)}</td>
                      <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">{attachmentCountText(n.attachments)}</td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEditModal(n)}>
                            수정
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(n)}>
                            삭제
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold text-gray-900">
                {modalMode === 'create' ? '공지사항 등록' : '공지사항 수정'}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="닫기"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
                  {formError}
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  등록자 *
                </label>
                <input
                  value={createdByInput}
                  onChange={(e) => setCreatedByInput(e.target.value)}
                  placeholder="이름을 입력하세요"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                />
                <p className="text-xs text-gray-500">
                  여러 관리자가 있을 경우, 등록자를 입력해 구분합니다.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">제목 *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">내용 *</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={7}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus-visible:ring-blue-500"
                  />
                  <span className="text-sm font-semibold text-gray-900">공지 고정</span>
                </label>

                <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={published}
                    onChange={(e) => setPublished(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus-visible:ring-blue-500"
                  />
                  <span className="text-sm font-semibold text-gray-900">바로 게시</span>
                </label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-sm font-medium text-gray-700">첨부파일 (최대 {MAX_ATTACHMENTS}개)</label>
                  <span className="text-xs text-gray-500">각 파일 {formatFileSize(MAX_SIZE_BYTES)} 이하</span>
                </div>

                {modalMode === 'edit' && attachments.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">기존 첨부</p>
                    {attachments.map((att, idx) => (
                      <div key={`${att.url}-${idx}`} className="p-3 rounded-md border border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900 truncate">{att.name}</div>
                          <div className="text-xs text-gray-500 mt-1">{formatFileSize(att.size)}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a href={att.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 text-sm underline">
                            다운로드
                          </a>
                          <Button variant="danger" size="sm" onClick={() => removeExistingAttachmentAt(idx)}>
                            삭제
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {newFiles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">추가될 첨부</p>
                    {newFiles.map((f, idx) => (
                      <div key={`${f.name}-${idx}`} className="p-3 rounded-md border border-gray-200 bg-white flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900 truncate">{f.name}</div>
                          <div className="text-xs text-gray-500 mt-1">{formatFileSize(f.size)}</div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => removeNewFileAt(idx)}>
                          제거
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  {!isAttachmentMaxed ? (
                    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">첨부파일 선택</p>
                          <p className="text-xs text-gray-500 mt-1">
                            최대 {MAX_ATTACHMENTS}개, 파일당 {formatFileSize(MAX_SIZE_BYTES)} 이하
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <label
                            htmlFor="notice-attachments"
                            className="inline-flex cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
                          >
                            파일 선택
                          </label>
                          <input
                            id="notice-attachments"
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              handleNewFilesAdd(e.target.files);
                              // 같은 파일 다시 선택 가능하도록 초기화
                              if (e.target) e.target.value = '';
                            }}
                          />
                        </div>
                      </div>
                      {newFiles.length === 0 ? (
                        <p className="text-xs text-gray-500 mt-2">아직 선택된 파일이 없습니다.</p>
                      ) : (
                        <p className="text-xs text-gray-600 mt-2">
                          선택된 파일: {newFiles.length}개 / {MAX_ATTACHMENTS}개
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4">
                      <p className="text-sm font-semibold text-gray-900">첨부파일</p>
                      <p className="text-xs text-gray-500 mt-1">
                        최대 {MAX_ATTACHMENTS}개까지 선택되어 있습니다. 더 이상 추가할 수 없습니다.
                      </p>
                    </div>
                  )}

                  <p className="text-xs text-gray-500">
                    첨부는 {MAX_ATTACHMENTS}개까지 가능하며, 파일당 {formatFileSize(MAX_SIZE_BYTES)}를 초과할 수 없습니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 sticky bottom-0 bg-white z-10">
              <Button variant="outline" onClick={closeModal} disabled={saving}>
                취소
              </Button>
              <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving}>
                {modalMode === 'create' ? '등록' : '저장'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

