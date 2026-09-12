import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Local dev servers for QA and production (`pnpm dev:qa` / `dev:prod`) build into their own folders so they can run
  // side by side. Vercel always expects `.next`, so the override is ignored there.
  distDir: (!process.env.VERCEL && process.env.NEXT_DIST_DIR) || '.next',
  // The shared TS engine (config contract, definition parser/resolver) ships as TypeScript source.
  transpilePackages: ['@fess-pos/engine'],
  // Linting runs as its own quality gate (`pnpm lint`); keep it in the build too.
  eslint: { dirs: ['src', 'e2e'] },
};

export default nextConfig;
