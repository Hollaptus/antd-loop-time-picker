import { defineConfig } from "tsup";

// Build config for the published package.
export default defineConfig({
    // Entry point of the package. tsup follows imports from here
    // and bundles everything into a single file per format.
    entry: ["src/index.js"],

    // Build for both module formats:
    //   - "esm" → dist/index.js   (matches "import" in exports)
    //   - "cjs" → dist/index.cjs  (matches "require" in exports)
    // Consumers pick the right one via 'exports' in package.json.
    format: ["esm", "cjs"],

    // Destination directory for build artifacts.
    outDir: "dist",

    // Remove everything from outDir before build to avoid stale files.
    clean: true,

    // Generate .map files so the original source is visible in DevTools
    // when debugging the published bundle.
    sourcemap: true,

    // Peer dependencies expected to be provided by the consumer.
    external: ["react", "react-dom", "antd", "dayjs"],

    // Use the automatic JSX runtime (React 17+): JSX is compiled to
    // 'react/jsx-runtime' imports, so files with JSX no longer need
    // 'import React from "react"' to be in scope.
    esbuildOptions(options) {
        options.jsx = "automatic";
    }
})