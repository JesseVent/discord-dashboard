import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ["@electric-sql/pglite", "@supabase/lite"],
  // @supabase/lite's DDL-translation layer pulls in libpg-query, whose
  // emscripten bundle references Node built-ins the browser build never
  // actually needs (guarded by a runtime env check the bundler can't
  // eliminate statically). Stub them out for the client bundle only.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/empty-node-shim.ts" },
      path: { browser: "./src/lib/empty-node-shim.ts" },
      os: { browser: "./src/lib/empty-node-shim.ts" },
      "@sqlite.org/sqlite-wasm/dist/sqlite3-worker1.mjs": { browser: "./src/lib/empty-node-shim.ts" },
      "./sqlite3-worker1.mjs": { browser: "./src/lib/empty-node-shim.ts" },
    },
  },
};

export default nextConfig;
