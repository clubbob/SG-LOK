"use client";

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Header, Footer } from '@/components/layout';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, orderBy, onSnapshot, Timestamp as FirestoreTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ProductionRequest, ProductionRequestStatus } from '@/types';
import { formatDateShort } from '@/lib/utils';
import { Button } from '@/components/ui';

const STATUS_COLORS: Record<ProductionRequestStatus, string> = {
  pending_review: 'bg-yellow-400',
  confirmed: 'bg-blue-500',
  in_progress: 'bg-green-500',
  completed: 'bg-gray-500',
  cancelled: 'bg-red-500',
};

const STATUS_LABELS: Record<ProductionRequestStatus, string> = {
  pending_review: '검토 대기',
  confirmed: '계획 확정',
  in_progress: '진행 중',
  completed: '생산 완료',
  cancelled: '취소',
};

interface GanttTask {
  id: string;
  name: string;
  start: Date;
  end: Date;
  status: ProductionRequestStatus;
  productionLine: string;
  productName: string;
  quantity: number;
  userName: string;
}

function ProductionCalendarContent() {
  const { isAuthenticated, userProfile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [requests, setRequests] = useState<ProductionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDateRange, setSelectedDateRange] = useState<{ start: Date; end: Date }>(() => {
    const today = new Date();
    // 한국 시간 기준으로 날짜 생성
    const start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0); // 이번 달 1일
    const end = new Date(today.getFullYear(), today.getMonth() + 2, 0, 23, 59, 59, 999); // 다음 달 마지막 날
    return { start, end };
  });

  useEffect(() => {
    if (authLoading) return;
    
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    // 실시간 생산요청 목록 구독
    const q = query(
      collection(db, 'productionRequests'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const requestsData: ProductionRequest[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Firestore Timestamp를 Date로 변환 (로컬 시간 사용)
          const convertFirestoreDate = (timestamp: FirestoreTimestamp | null | undefined): Date | undefined => {
            if (!timestamp) return undefined;
            return timestamp.toDate();
          };
          
          const request: ProductionRequest = {
            id: doc.id,
            ...data,
            requestDate: convertFirestoreDate(data.requestDate) || new Date(),
            requestedCompletionDate: convertFirestoreDate(data.requestedCompletionDate) || new Date(),
            plannedStartDate: convertFirestoreDate(data.plannedStartDate),
            plannedCompletionDate: convertFirestoreDate(data.plannedCompletionDate),
            actualStartDate: convertFirestoreDate(data.actualStartDate),
            actualCompletionDate: convertFirestoreDate(data.actualCompletionDate),
            createdAt: convertFirestoreDate(data.createdAt) || new Date(),
            updatedAt: convertFirestoreDate(data.updatedAt) || new Date(),
          } as ProductionRequest;
          
          requestsData.push(request);
        });
        setRequests(requestsData);
        setLoading(false);
      },
      (error) => {
        console.error('생산요청 목록 로드 오류:', error);
        setError('생산요청 목록을 불러오는데 실패했습니다.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [isAuthenticated, authLoading, router]);

  // 날짜를 한국 시간 기준으로 정규화
  const normalizeToKST = (date: Date): Date => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    // 한국 시간대 기준으로 날짜 생성 (로컬 시간 사용)
    return new Date(year, month, day, 0, 0, 0, 0);
  };

  // 날짜 범위 계산
  const getDaysBetween = (start: Date, end: Date): number => {
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  };

  // 간트 차트용 태스크 변환
  const convertToGanttTasks = (requests: ProductionRequest[]): GanttTask[] => {
    const filtered = requests.filter((req) => {
        // 취소된 요청 제외
        if (req.status === 'cancelled') {
          return false;
        }
        
        // 검토 대기 상태: 모든 검토 대기 요청 표시 (날짜 정보가 없어도 표시)
        if (req.status === 'pending_review') {
          return true; // 검토 대기 요청은 모두 표시
        }
        
        // 확정된 요청 (confirmed, in_progress, completed): 모두 표시
        return true; // 확정된 요청은 모두 표시
      });
    
    return filtered
      .map((req) => {
        let startDate: Date;
        let endDate: Date;
        let productionLine: string;
        
        if (req.status === 'pending_review') {
          // 검토 대기: 등록일부터 완료요청일까지 표시
          const requestStart = req.requestDate || req.createdAt || new Date();
          // 시작일을 한국 시간 기준으로 정규화
          startDate = normalizeToKST(requestStart);
          
          // 완료요청일이 없으면 등록일 + 30일로 설정
          const requestedEnd = req.requestedCompletionDate || 
            (requestStart ? new Date(requestStart.getTime() + 30 * 24 * 60 * 60 * 1000) : new Date());
          // 종료일을 한국 시간 기준으로 정규화
          endDate = normalizeToKST(requestedEnd);
          productionLine = '검토 대기';
        } else if (req.status === 'confirmed' || req.status === 'in_progress') {
          // 계획 확정/진행 중: 등록일 ~ 완료예정일
          const requestStart = req.requestDate || req.createdAt || new Date();
          startDate = normalizeToKST(requestStart);
          const plannedEnd = req.plannedCompletionDate ||
            req.requestedCompletionDate ||
            (requestStart ? new Date(requestStart.getTime() + 30 * 24 * 60 * 60 * 1000) : new Date());
          endDate = normalizeToKST(plannedEnd);
          productionLine = req.productionLine || '미지정';
        } else if (req.status === 'completed') {
          // 생산완료: 등록일 ~ 생산완료일
          const requestStart = req.requestDate || req.createdAt || new Date();
          startDate = normalizeToKST(requestStart);
          const actualEnd = req.actualCompletionDate ||
            req.plannedCompletionDate ||
            req.requestedCompletionDate ||
            (requestStart ? new Date(requestStart.getTime() + 30 * 24 * 60 * 60 * 1000) : new Date());
          endDate = normalizeToKST(actualEnd);
          productionLine = req.productionLine || '미지정';
        } else {
          // 그 외 상태: 기존 로직 유지
          const plannedEnd = req.plannedCompletionDate || 
            req.requestedCompletionDate || 
            (req.requestDate || req.createdAt 
              ? new Date((req.requestDate || req.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000)
              : new Date());
          
          const plannedStart = req.plannedStartDate || 
            (plannedEnd 
              ? new Date(plannedEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
              : new Date());
          
          // 한국 시간 기준으로 정규화
          startDate = normalizeToKST(plannedStart);
          endDate = normalizeToKST(plannedEnd);
          productionLine = req.productionLine || '미지정';
        }

        return {
          id: req.id,
          name: `${req.productName} (${req.quantity.toLocaleString()})`,
          start: startDate,
          end: endDate,
          status: req.status,
          productionLine: productionLine,
          productName: req.productName,
          quantity: req.quantity,
          userName: req.userName,
        };
      });
  };

  // 라인별로 그룹화
  const groupByLine = (tasks: GanttTask[]): Record<string, GanttTask[]> => {
    return tasks.reduce((acc, task) => {
      const line = task.productionLine;
      if (!acc[line]) {
        acc[line] = [];
      }
      acc[line].push(task);
      return acc;
    }, {} as Record<string, GanttTask[]>);
  };

  // 날짜 헤더 생성 (한국 시간 기준)
  const generateDateHeaders = () => {
    const headers: Date[] = [];
    const start = normalizeToKST(selectedDateRange.start);
    const end = normalizeToKST(selectedDateRange.end);
    const current = new Date(start);
    
    // 날짜 비교를 위해 종료일을 정규화
    const normalizedEnd = normalizeToKST(end);
    
    while (current.getTime() <= normalizedEnd.getTime()) {
      headers.push(new Date(current));
      const nextDate = new Date(current);
      nextDate.setDate(nextDate.getDate() + 1);
      current.setTime(nextDate.getTime());
    }
    return headers;
  };

  const dateHeaders = generateDateHeaders();
  // 날짜 헤더 셀의 고정 너비
  const cellWidth = 50; // 각 날짜 셀의 고정 너비
  const containerWidth = dateHeaders.length * cellWidth; // 실제 컨테이너 너비

  // 날짜를 X 좌표로 변환 (날짜 헤더 셀의 시작 위치에 맞춤)
  const dateToX = (date: Date): number => {
    // 날짜를 한국 시간 기준으로 정규화
    const normalizedDate = normalizeToKST(date);
    const targetYear = normalizedDate.getFullYear();
    const targetMonth = normalizedDate.getMonth();
    const targetDay = normalizedDate.getDate();
    
    // 날짜 헤더에서 해당 날짜의 인덱스 찾기
    let dateIndex = -1;
    for (let i = 0; i < dateHeaders.length; i++) {
      const headerDate = normalizeToKST(dateHeaders[i]);
      const headerYear = headerDate.getFullYear();
      const headerMonth = headerDate.getMonth();
      const headerDay = headerDate.getDate();
      
      // 정확한 날짜 매칭
      if (headerYear === targetYear &&
          headerMonth === targetMonth &&
          headerDay === targetDay) {
        dateIndex = i;
        break;
      }
    }
    
    if (dateIndex >= 0) {
      // 날짜 헤더 셀의 실제 위치 계산 (고정 너비 사용)
      return dateIndex * cellWidth;
    }
    
    // 날짜를 찾을 수 없으면 기존 방식으로 계산
    const daysBetween = getDaysBetween(selectedDateRange.start, selectedDateRange.end);
    const daysFromStart = getDaysBetween(selectedDateRange.start, normalizedDate);
    return (daysFromStart / daysBetween) * containerWidth;
  };

  // 날짜 폭 계산
  const getDateWidth = (start: Date, end: Date): number => {
    // 시작일과 종료일을 한국 시간 기준으로 정규화
    const normalizedStart = normalizeToKST(start);
    const normalizedEnd = normalizeToKST(end);
    
    const startYear = normalizedStart.getFullYear();
    const startMonth = normalizedStart.getMonth();
    const startDay = normalizedStart.getDate();
    const endYear = normalizedEnd.getFullYear();
    const endMonth = normalizedEnd.getMonth();
    const endDay = normalizedEnd.getDate();
    
    // 시작일과 종료일의 인덱스 찾기
    let startIndex = -1;
    let endIndex = -1;
    
    for (let i = 0; i < dateHeaders.length; i++) {
      const headerDate = normalizeToKST(dateHeaders[i]);
      const headerYear = headerDate.getFullYear();
      const headerMonth = headerDate.getMonth();
      const headerDay = headerDate.getDate();
      
      if (startIndex < 0 && 
          headerYear === startYear &&
          headerMonth === startMonth &&
          headerDay === startDay) {
        startIndex = i;
      }
      if (headerYear === endYear &&
          headerMonth === endMonth &&
          headerDay === endDay) {
        endIndex = i;
      }
    }
    
    if (startIndex >= 0 && endIndex >= 0 && endIndex >= startIndex) {
      // 날짜 헤더 셀의 실제 너비 계산 (고정 너비 사용)
      // 종료일 포함 (endIndex - startIndex + 1)
      return (endIndex - startIndex + 1) * cellWidth;
    }
    
    // 날짜를 찾을 수 없으면 기존 방식으로 계산
    const daysBetween = getDaysBetween(selectedDateRange.start, selectedDateRange.end);
    const taskDays = getDaysBetween(normalizedStart, normalizedEnd) + 1; // 종료일 포함
    return (taskDays / daysBetween) * containerWidth;
  };

  // 검색 필터링 (제품명, 요청자, 상태로 검색)
  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) {
      return requests;
    }

    const query = searchQuery.toLowerCase().trim();
    return requests.filter((request) => {
      const productName = request.productName?.toLowerCase() || '';
      const userName = request.userName?.toLowerCase() || '';
      const statusLabel = STATUS_LABELS[request.status]?.toLowerCase() || request.status || '';
      return (
        productName.includes(query) ||
        userName.includes(query) ||
        statusLabel.includes(query)
      );
    });
  }, [searchQuery, requests]);

  const tasks = convertToGanttTasks(filteredRequests);
  const tasksByLine = groupByLine(tasks);
  const lines = Object.keys(tasksByLine).sort();

  // 이전/다음 달 이동
  const moveMonth = (direction: 'prev' | 'next') => {
    setSelectedDateRange((prev) => {
      const newStart = new Date(prev.start);
      if (direction === 'prev') {
        newStart.setMonth(newStart.getMonth() - 1);
      } else {
        newStart.setMonth(newStart.getMonth() + 1);
      }
      // 한국 시간 기준으로 날짜 설정
      const start = new Date(newStart.getFullYear(), newStart.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(newStart.getFullYear(), newStart.getMonth() + 2, 0, 23, 59, 59, 999);
      return { start, end };
    });
  };

  // 새로고침
  const handleRefresh = () => {
    setLoading(true);
    setError(null);
    // 페이지 새로고침
    window.location.reload();
  };

  if (authLoading || loading) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-gray-50">
          <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">로딩 중...</p>
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">생산일정 캘린더</h1>
              <p className="text-gray-600 mt-2">생산 일정을 간트 차트 형식으로 확인할 수 있습니다</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              새로고침
            </Button>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {/* 검색 입력 필드 */}
          <div className="mb-4">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="제품명, 요청자, 상태로 검색..."
                className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 pl-10 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              />
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* 날짜 네비게이션 */}
          <div className="mb-4 flex items-center justify-between bg-white rounded-lg shadow-sm p-4">
            <button
              onClick={() => moveMonth('prev')}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              이전 달
            </button>
            <div className="text-lg font-semibold text-gray-900">
              {selectedDateRange.start.getFullYear()}년 {selectedDateRange.start.getMonth() + 1}월
            </div>
            <button
              onClick={() => moveMonth('next')}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              다음 달
            </button>
          </div>

          {/* 범례 */}
          <div className="mb-4 bg-white rounded-lg shadow-sm p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">상태 범례</h3>
            <div className="flex flex-wrap gap-4">
          {Object.entries(STATUS_LABELS)
            .filter(([status]) => status !== 'cancelled' && status !== 'in_progress')
            .map(([status, label]) => (
                  <div key={status} className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded ${STATUS_COLORS[status as ProductionRequestStatus]}`}></div>
                    <span className="text-sm text-gray-700">{label}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* 간트 차트 */}
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            {lines.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-600">표시할 생산 일정이 없습니다.</p>
                <p className="text-sm text-gray-500 mt-2">생산라인과 완료예정일이 확정된 요청만 표시됩니다.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div style={{ minWidth: `${containerWidth}px` }}>
                  {/* 날짜 헤더 */}
                  <div className="border-b border-gray-200 sticky top-0 bg-white z-10">
                    {/* 월 레이블 행 */}
                    <div className="flex border-b-2 border-gray-300 bg-white">
                      <div className="flex relative" style={{ minHeight: '32px', width: `${containerWidth}px`, marginLeft: '96px' }}>
                        {dateHeaders.map((date, idx) => {
                          const isFirstDayOfMonth = date.getDate() === 1;
                          const prevDate = idx > 0 ? dateHeaders[idx - 1] : null;
                          const isMonthChange = prevDate && prevDate.getMonth() !== date.getMonth();
                          // 첫 번째 날짜이거나 월의 첫 날이거나 월이 변경된 경우 월 레이블 표시
                          const shouldShowMonthLabel = idx === 0 || isFirstDayOfMonth || isMonthChange;
                          
                          // 월이 시작되는 날짜를 찾아서 해당 월의 마지막 날까지 span 계산
                          let monthSpan = 1;
                          if (shouldShowMonthLabel) {
                            const currentMonth = date.getMonth();
                            const currentYear = date.getFullYear();
                            let nextMonthStart = idx + 1;
                            while (nextMonthStart < dateHeaders.length) {
                              const nextDate = dateHeaders[nextMonthStart];
                              // 다음 달로 변경되면 중단
                              if (nextDate.getMonth() !== currentMonth || nextDate.getFullYear() !== currentYear) {
                                break;
                              }
                              monthSpan++;
                              nextMonthStart++;
                            }
                            // 마지막 날짜까지 포함
                            if (nextMonthStart === dateHeaders.length) {
                              monthSpan = dateHeaders.length - idx;
                            }
                            // 최소 너비 보장 (최소 3개 셀)
                            if (monthSpan < 3) {
                              monthSpan = Math.max(monthSpan, 3);
                            }
                          }
                          
                          return (
                            <div
                              key={idx}
                              className="relative"
                              style={{ width: `${cellWidth}px`, flexShrink: 0 }}
                            >
                              {isMonthChange && (
                                <div className="absolute left-0 top-0 bottom-0 w-px bg-gray-200 z-20"></div>
                              )}
                              {shouldShowMonthLabel && monthSpan > 0 && (
                                <div 
                                  className="absolute top-0 bottom-0 flex items-center justify-start bg-blue-50 border-l border-gray-200 z-30 pl-2"
                                  style={{ 
                                    left: '0px',
                                    width: `${monthSpan * cellWidth}px`,
                                    minWidth: `${monthSpan * cellWidth}px`,
                                    pointerEvents: 'none',
                                    display: 'flex',
                                    visibility: 'visible',
                                    opacity: 1
                                  }}
                                >
                                  <span className="text-sm font-semibold text-blue-700 whitespace-nowrap pointer-events-auto">
                                    {date.getFullYear()}년 {date.getMonth() + 1}월
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    
                    {/* 날짜 행 */}
                    <div className="flex">
                      <div className="flex" style={{ width: `${containerWidth}px`, marginLeft: '96px' }}>
                        {dateHeaders.map((date, idx) => {
                          const dayOfWeek = date.getDay(); // 0: 일요일, 6: 토요일
                          const isSaturday = dayOfWeek === 6;
                          const isSunday = dayOfWeek === 0;
                          const isToday = date.toDateString() === new Date().toDateString();
                          const prevDate = idx > 0 ? dateHeaders[idx - 1] : null;
                          const isMonthChange = prevDate && prevDate.getMonth() !== date.getMonth();
                          
                          // 토요일: 파랑색, 일요일: 빨강색
                          let dateColorClass = 'text-gray-700';
                          if (isSaturday) {
                            dateColorClass = 'text-blue-600';
                          } else if (isSunday) {
                            dateColorClass = 'text-red-600';
                          }
                          if (isToday) {
                            dateColorClass += ' font-bold';
                          }
                          
                          return (
                            <div
                              key={idx}
                              className={`border-r border-gray-200 p-2 text-xs text-center relative bg-white ${
                                isMonthChange ? 'border-l border-gray-200' : ''
                              }`}
                              style={{ width: `${cellWidth}px`, flexShrink: 0 }}
                            >
                              <div className={dateColorClass}>{date.getDate()}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* 라인별 태스크 */}
                  {lines.map((line) => {
                    const lineTasks = tasksByLine[line];
                    return (
                      <div key={line} className="border-b border-gray-200">
                        <div className="flex relative" style={{ minHeight: `${Math.max(60, lineTasks.length * 50 + 16)}px` }}>
                          {/* 라인 이름 */}
                          <div className="w-24 border-r border-gray-200 px-3 py-2 bg-gray-50 flex items-center sticky left-0 z-20">
                            <span className="font-semibold text-sm text-gray-900 whitespace-nowrap">{line}</span>
                          </div>

                          {/* 태스크 바 영역 */}
                          <div className="flex-1 relative" style={{ minHeight: `${Math.max(60, lineTasks.length * 50 + 16)}px` }}>
                            {lineTasks.map((task, taskIdx) => {
                              // 한국 시간 기준으로 날짜 정규화
                              const taskStartDate = normalizeToKST(task.start);
                              const taskEndDate = normalizeToKST(task.end);
                              
                              const x = dateToX(taskStartDate);
                              // 종료일 포함하여 너비 계산
                              const width = Math.max(getDateWidth(taskStartDate, taskEndDate), 50);
                              const isOverdue = task.end < new Date() && task.status !== 'completed';

                              // 같은 라인에 여러 태스크가 있을 때 세로로 배치 (각 태스크마다 50px 간격, 상단 여백 8px)
                              const topOffset = taskIdx * 50 + 8;

                              return (
                                <div
                                  key={task.id}
                                  className="absolute"
                                  style={{
                                    left: `${x}px`,
                                    top: `${topOffset}px`,
                                    width: `${width}px`,
                                    zIndex: 10 - taskIdx,
                                  }}
                                >
                                  <div
                                    className={`${STATUS_COLORS[task.status]} text-white rounded px-2 py-2 text-xs shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
                                      isOverdue ? 'ring-2 ring-red-500' : ''
                                    }`}
                                    title={`${task.productName} (${task.quantity.toLocaleString()}) - ${task.userName} - ${STATUS_LABELS[task.status]} - ${formatDateShort(task.start)} ~ ${formatDateShort(task.end)}`}
                                  >
                                    <div className="font-semibold truncate whitespace-nowrap">
                                      {task.productName} | {task.quantity.toLocaleString()}개 | {task.userName}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default function ProductionCalendarPage() {
  return (
    <Suspense fallback={
      <>
        <Header />
        <div className="min-h-screen bg-gray-50">
          <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">로딩 중...</p>
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </>
    }>
      <ProductionCalendarContent />
    </Suspense>
  );
}

