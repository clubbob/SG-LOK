"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header, Footer } from "@/components/layout";
import { useAuth } from "@/hooks/useAuth";
import {
  InventoryScannerView,
  type ScannerMode,
} from "@/components/inventory/InventoryScannerView";

function InventoryScanInner() {
  const sp = useSearchParams();
  const m = sp.get("mode");
  const initial: ScannerMode | undefined =
    m === "in"
      ? "in"
      : m === "out"
        ? "out"
      : m === "production" || m === "prod"
        ? "production"
        : undefined;
  return <InventoryScannerView initialMode={initial} />;
}

export default function InventoryScanPage() {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push("/login");
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
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
      <main className="flex-1 bg-gray-50 py-4">
        <Suspense
          fallback={
            <div className="p-6 text-center text-sm text-gray-600">
              스캐너 화면을 불러오는 중…
            </div>
          }
        >
          <InventoryScanInner />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
