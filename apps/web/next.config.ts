import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { NextConfig } from 'next';

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // The dashboard transpiles the workspace core package (published as TS source
  // via the workspace `import` condition pointing at compiled dist).
  transpilePackages: ['@openrelay/core'],
  // Pin file-tracing to the monorepo root so standalone output resolves workspace
  // dependencies correctly and silences multi-lockfile inference warnings.
  outputFileTracingRoot: monorepoRoot,
  eslint: {
    // Linting is a dedicated CI step (`pnpm lint` → strict flat config in
    // eslint.config.mjs). Next's built-in build-time pass is redundant and does
    // not understand the FlatCompat-wrapped config, so skip it here. No rules are
    // relaxed — `eslint .` remains the enforced gate.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
