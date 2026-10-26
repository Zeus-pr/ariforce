import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@ariforce/ui', '@ariforce/contracts'],
};

export default nextConfig;
