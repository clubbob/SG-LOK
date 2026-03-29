import type { NextConfig } from "next";

/**
 * 기본 `npm run dev` 는 `.next-alt` 를 씁니다 (Windows `.next/trace` EPERM 완화).
 * 표준 `.next`만 쓰려면 `npm run dev:classic` 을 사용하세요.
 */
const distDir = process.env.NEXT_USE_ALT_DIST === "1" ? ".next-alt" : ".next";

const nextConfig: NextConfig = {
  distDir,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

