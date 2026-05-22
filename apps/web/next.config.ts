import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  cleanDistDir: true,
  // Engine resolves to ./src/index.ts under the "development" webpack condition
  // (set by the package's exports field). Adding it to transpilePackages tells
  // Next.js/SWC to transpile those TypeScript source files for both server and
  // client bundles — fixing the "Module parse failed: Unexpected token" error.
  // It cannot also be in serverExternalPackages (Next.js rejects the conflict).
  // sharp is kept as a webpack external below; Node.js built-ins are auto-excluded.
  transpilePackages: ["@iterastudio/engine"],
  serverExternalPackages: ["@iterastudio/db", "better-sqlite3", "bindings", "sharp"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  webpack: (config, { isServer }) => {
    config.resolve.symlinks = false;
    // When /engine resolves to its TypeScript source via the "development"
    // export condition, internal imports like "./executionGraph.js" fail because
    // only the .ts file exists. extensionAlias maps .js → [.ts, .js] so webpack
    // finds the TypeScript source file first without requiring import changes.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    // With resolve.symlinks = false, pnpm creates two separate symlink paths to
    // /shared (one under apps/web/node_modules, one under
    // packages/engine/node_modules). Webpack treats them as different modules,
    // producing two nodeRegistry singletons — one populated by
    // initializeNodeRegistry(), another empty one used by the engine executor.
    // The alias below collapses both to a single canonical dist path so the
    // registry populated at startup is the same instance the executor reads.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@iterastudio/shared": path.resolve(__dirname, "../../packages/shared/dist/index.js"),
    };
    if (isServer) {
      const existing = Array.isArray(config.externals)
        ? config.externals
        : config.externals
        ? [config.externals]
        : [];
      config.externals = [...existing, "sharp"];
    }
    return config;
  },
};

export default nextConfig;
