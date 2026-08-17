import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),  // Uncomment and add 'import path from "path"' if needed
  /* config options here */
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    // 不要放开为 hostname: '*'：那会把 /_next/image 变成任意主机的开放图片代理
    // （带宽滥用 + 对内网可解析主机的 SSRF 面）。新增外部图源请逐个显式登记。
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'photo.chaoxing.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
