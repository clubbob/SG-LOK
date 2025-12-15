"use client";

import { useState, useEffect } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { User as UserType } from '@/types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      
      if (user) {
        try {
          // Firestore에서 사용자 프로필 정보 가져오기 (재시도 로직 포함)
          let userDoc = null;
          let retries = 3;
          
          while (retries > 0) {
            try {
              userDoc = await getDoc(doc(db, 'users', user.uid));
              break; // 성공하면 루프 종료
            } catch (error: unknown) {
              const firestoreError = error as { code?: string; message?: string };
              // 오프라인 오류인 경우 재시도
              if (firestoreError.message?.includes('offline') || firestoreError.code === 'unavailable') {
                retries--;
                if (retries > 0) {
                  console.log(`Firestore 오프라인 오류, ${retries}번 더 재시도합니다...`);
                  await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기 후 재시도
                  continue;
                }
              }
              // 다른 오류는 즉시 throw
              throw error;
            }
          }
          
          if (userDoc && userDoc.exists()) {
            const userData = userDoc.data() as UserType;
            // 삭제된 사용자인지 확인
            if (userData.deleted) {
              console.log('삭제된 사용자 계정입니다. 자동 로그아웃합니다.');
              await firebaseSignOut(auth);
              setUser(null);
              setUserProfile(null);
              return;
            }
            setUserProfile(userData);
          } else {
            // 문서가 없어도 정상적으로 처리 (회원가입 직후일 수 있음)
            console.log('사용자 프로필이 아직 Firestore에 저장되지 않았습니다.');
            setUserProfile(null);
          }
        } catch (error) {
          console.error('사용자 프로필을 가져오는 중 오류:', error);
          // 오류가 발생해도 사용자는 인증된 상태이므로 계속 진행
          setUserProfile(null);
        }
      } else {
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      setUser(null);
      setUserProfile(null);
    } catch (error) {
      console.error('로그아웃 오류:', error);
      throw error;
    }
  };

  const isAuthenticated = !!user && userProfile !== null && userProfile.approved !== false;

  return {
    user,
    userProfile,
    isAuthenticated,
    loading,
    signOut,
  };
}

