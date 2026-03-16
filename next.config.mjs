/** @type {import('next').NextConfig} */
const nextConfig = {
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