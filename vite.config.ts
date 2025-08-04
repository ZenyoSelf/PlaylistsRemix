import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
      ignoredRouteFiles: ["**/*.css"],
    }),
    tsconfigPaths(),
  ],
  optimizeDeps: {
    exclude: [
      "@mapbox/node-pre-gyp",
      "mock-aws-s3",
      "aws-sdk",
      "nock",
      "sqlite3"
    ],
  },
  ssr: {
    external: ["sqlite3", "bcrypt", "@mapbox/node-pre-gyp"],
    noExternal: []
  },
  define: {
    global: "globalThis",
  },
});
