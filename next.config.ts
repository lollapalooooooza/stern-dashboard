import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: '.',
  },
  async rewrites() {
    return [
      {
        source: '/catalyst-api/:path*',
        destination: `${process.env.CATALYST_API_URL || 'http://127.0.0.1:8000'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
