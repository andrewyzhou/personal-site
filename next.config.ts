import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/wave-poser/:path*',
        destination: 'https://wave-poser-90ywfw9bf-andrewyzhous-projects.vercel.app/wave-poser/:path*',
      },
    ];
  },
};

export default nextConfig;
