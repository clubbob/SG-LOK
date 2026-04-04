import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  /**
   * Windows에서 일부 환경(백신·네트워크 드라이브·파일 잠금)에서 파일 이벤트가 불안정하면
   * 저장 직후 HMR이 꼬이거나 Internal Server Error가 잠깐 나는 경우가 있습니다.
   * 폴링으로 감시하면 안정적인 편입니다.
   */
  webpack: (config, { dev }) => {
    if (dev && process.platform === "win32") {
      config.watchOptions = {
        poll: 2000,
        aggregateTimeout: 500,
      };
    }
    return config;
  },
};

export default nextConfig;
