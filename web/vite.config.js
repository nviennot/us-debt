import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const RESULTS = path.resolve(__dirname, "../results.json");

// Serve ../results.json at /results.json in dev, and copy it into the build
// output so it ships as a separate static asset instead of being bundled.
function resultsJson() {
  return {
    name: "results-json",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/results.json") {
          res.setHeader("Content-Type", "application/json");
          fs.createReadStream(RESULTS).pipe(res);
        } else {
          next();
        }
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "results.json",
        source: fs.readFileSync(RESULTS),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), resultsJson()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          recharts: ["recharts"],
        },
      },
    },
  },
});
