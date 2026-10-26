import type { NextConfig } from 'next';

// Real-mode builds get their own output folder so a mock build (e2e on :3100) can never overwrite
// the chunks a running real-mode server (:3200) is serving. Set the same env for build and start.
const real = process.env.NEXT_PUBLIC_API_MODE === 'real';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? (real ? '.next-real' : '.next'),
  transpilePackages: ['@ariforce/ui', '@ariforce/contracts'],
};

export default nextConfig;
