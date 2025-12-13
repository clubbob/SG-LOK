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
          // Firestore에서 사용자 프로필 정보 가져오기
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
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
            setUserProfile(null);
          }
        } catch (error) {
          console.error('사용자 프로필을 가져오는 중 오류:', error);
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

  return {
    user,
    userProfile,
    isAuthenticated: !!user,
    loading,
    signOut,
  };
}

