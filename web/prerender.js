// Post-build prerender: render the SPA to static HTML and inject it into the
// built index.html so crawlers (and no-JS clients) get real content. The client
// bundle still hydrates/takes over on load as before.
//
// The app is loaded through Vite's SSR module loader so JSX, CSS imports, and
// node_modules (recharts) resolve exactly like in the normal build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "dist");
const resultsPath = path.resolve(distDir, "results.json");
const htmlPath = path.resolve(distDir, "index.html");

// Provide a browser-like environment. App.jsx and ChatFooter.jsx touch
// window.matchMedia, localStorage, etc. at module load / render time.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
if (!("navigator" in globalThis) || !globalThis.navigator) {
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
}
globalThis.localStorage = dom.window.localStorage;
if (!dom.window.matchMedia) {
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
}
globalThis.matchMedia = dom.window.matchMedia;

// loadResults() fetches /results.json; serve it from the build output on disk.
const resultsData = fs.readFileSync(resultsPath, "utf8");
globalThis.fetch = async () => ({ json: async () => JSON.parse(resultsData) });

const vite = await createServer({
  root: __dirname,
  server: { middlewareMode: true },
  appType: "custom",
  // CSS imports are irrelevant for static markup; don't let them break SSR.
  css: { transformer: "postcss" },
});

try {
  const { default: App, loadResults } = await vite.ssrLoadModule("/src/App.jsx");
  await loadResults();
  const appHtml = renderToString(React.createElement(App));

  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
  fs.writeFileSync(htmlPath, html);

  console.log("prerendered index.html (root filled with", appHtml.length, "chars)");
} finally {
  await vite.close();
}
