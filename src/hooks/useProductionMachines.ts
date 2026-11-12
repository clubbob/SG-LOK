'use client';

import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { fetchProductionMachinesFromApi } from '@/lib/production/fetchProductionMachines';
import type { ProductionMachine } from '@/lib/production/productionMachines';

export function useProductionMachines(enabled = true) {
  const [machines, setMachines] = useState<ProductionMachine[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const refetch = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setMachines([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (!auth.currentUser) {
        if (!cancelled) {
          setMachines([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const list = await fetchProductionMachinesFromApi();
        if (!cancelled) {
          setMachines(list);
        }
      } catch (e) {
        console.error('기계 목록 조회 오류:', e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '기계 목록 조회 실패');
          setMachines([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const unsubscribe = onAuthStateChanged(auth, () => {
      void load();
    });

    void load();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, reloadNonce]);

  return { machines, loading, error, refetch };
}
