import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: 'export', // API 라우트 사용을 위해 주석 처리
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  /* config options here */
};

export default nextConfig;

