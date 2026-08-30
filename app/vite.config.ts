import path from "path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

const analyze = process.env.ANALYZE === "1" || process.env.ANALYZE === "true";

function pickSupabaseEnv(env: Record<string, string>) {
  const url = (
    env.VITE_SUPABASE_URL ||
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  const anonKey = (
    env.VITE_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();
  return { url, anonKey };
}

/** Heavy vendors — split for caching; excalidraw isolated so lazy routes do not land in subset-shared. */
function manualChunkForNodeModule(id: string): string | undefined {
  // Keep Vite's dynamic-import helper out of vendor-* chunks (otherwise entry imports a 3MB+ file at boot).
  if (id.includes("vite/preload-helper")) return "vite-preload";

  // React context modules — single chunk so lazy routes (Settings, XTermShell) share Provider context.
  if (id.includes("/src/context/WorkspaceContext")) return "workspace-context";

  // Shared integration helpers — must not live in dashboard.js or lazy IntegrationsSection imports the entry (cycle → crash).
  if (id.includes("integrationOAuthPopup")) return "integration-oauth";
  if (id.includes("resolveIntegrationIconUrl")) return "integration-icons";
  if (id.includes("/components/ui/AppIcon")) return "app-icon";

  if (!id.includes("node_modules")) return undefined;

  if (id.includes("@supabase")) return "vendor-supabase";
  if (/node_modules[/\\]@excalidraw[/\\]/.test(id)) return "vendor-excalidraw";
  if (/node_modules[/\\](mermaid[/\\]|cytoscape)/.test(id)) return undefined;
  if (
    /node_modules[/\\]mermaid[/\\].*(?:[/\\]locale|[/\\]locales)[/\\]/i.test(
      id,
    ) ||
    /[/\\]locale[s]?[/\\][a-z]{2}-[A-Z]{2}/.test(id)
  ) {
    return "vendor-locales";
  }
  if (
    id.includes("/three/") ||
    id.includes("three/addons") ||
    /[/\\]three[/\\]/.test(id)
  ) {
    return "vendor-three";
  }
  if (id.includes("katex")) return "vendor-katex";
  if (id.includes("remotion") || id.includes("@remotion"))
    return "vendor-remotion";
  if (id.includes("wardley") || id.includes("@ward")) return "vendor-wardley";
  if (id.includes("/locale/") || id.includes("/locales/"))
    return "vendor-locales";
  if (id.includes("@monaco-editor") || id.includes("monaco-editor"))
    return "vendor-editor";
  if (
    id.includes("node_modules/react-dom") ||
    id.includes("node_modules/react-router") ||
    /node_modules[/\\]react[/\\]/.test(id)
  ) {
    return "vendor-react";
  }
  if (id.includes("/recharts/") || /node_modules[/\\]recharts[/\\]/.test(id))
    return "vendor-charts";
  if (/node_modules[/\\]d3-[^/\\]+[/\\]/.test(id)) return "vendor-charts";
  if (id.includes("lucide-react")) return "vendor-icons";
  // Keep motion in vendor-react — isolated chunk resolves `react` to jsx export `h`, breaking createContext.
  if (
    id.includes("framer-motion") ||
    id.includes("motion-dom") ||
    id.includes("motion-utils")
  ) {
    return "vendor-react";
  }
  if (id.includes("@cloudflare/realtimekit") || id.includes("realtimekit"))
    return "vendor-realtimekit";

  return undefined;
}

const HEAVY_PRELOAD_RE =
  /(?:^|[/])(?:vendor-(?:three|wardley|remotion|locales|katex|charts|excalidraw|realtimekit)|vite-preload|subset-shared\.chunk|ExcalidrawView|DesignStudioPage|MeetRealtimeKitShell)\.js/;

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, "..");
  const env = {
    ...loadEnv(mode, repoRoot, ""),
    ...loadEnv(mode, __dirname, ""),
  };
  const { url: supabaseUrl, anonKey: supabaseAnonKey } = pickSupabaseEnv(env);
  let buildGitSha = String(process.env.IAM_BUILD_GIT_SHA || "").trim();
  if (!buildGitSha) {
    try {
      buildGitSha = execSync("git rev-parse HEAD", {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();
    } catch {
      buildGitSha = "dev";
    }
  }
  return {
    root: __dirname,
    base: "/",
    define: {
      __IAM_BUILD_GIT_SHA__: JSON.stringify(buildGitSha),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseAnonKey),
    },
    server: {
      port: 3000,
      host: "0.0.0.0",
      proxy: {
        "/api": "http://127.0.0.1:8787",
        "/assets": "http://127.0.0.1:8787",
      },
    },
    plugins: [
      react(),
      {
        name: "copy-auth-branding-helper",
        apply: "build",
        writeBundle(options) {
          const outDir = options.dir || path.resolve(__dirname, "dist");
          const sharedOutDir = path.join(outDir, "shared");
          const brandingSource = path.resolve(__dirname, "shared/company-branding.js");
          if (!fs.existsSync(brandingSource)) {
            throw new Error(`Canonical auth branding helper missing: ${brandingSource}`);
          }
          fs.mkdirSync(sharedOutDir, { recursive: true });
          fs.copyFileSync(brandingSource, path.join(sharedOutDir, "company-branding.js"));
        },
      },
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        strategies: "generateSW",
        filename: "sw.js",
        manifestFilename: "manifest.webmanifest",
        includeAssets: ["offline.html", "pwa-recovery.html"],
        manifest: {
          name: "IAM",
          short_name: "IAM",
          description: "Agent Sam workspace — build, deploy, and optimize.",
          start_url: "/dashboard/home",
          scope: "/",
          display: "standalone",
          orientation: "any",
          background_color: "#000000",
          theme_color: "#000000",
          icons: [
            {
              src: "/pwa/icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa/apple-touch-icon.png",
              sizes: "180x180",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          /** Single-file SW at /sw.js — no hashed workbox-*.js deploy drift. */
          inlineWorkboxRuntime: true,
          importScripts: ["push-handler.js", "sw-agent-cache.js"],
          skipWaiting: false,
          clientsClaim: false,
          /** HTML loads dashboard.js?v=… — must match precache entries without falling through to stale runtime cache. */
          ignoreURLParametersMatching: [/^v$/],
          globDirectory: path.resolve(__dirname, "dist"),
          globPatterns: ["index.html", "dashboard.css", "pwa/*.png"],
          globIgnores: [
            "**/vendor-excalidraw*.js",
            "**/vendor-realtimekit*.js",
            "**/vendor-three*.js",
            "**/vendor-remotion*.js",
            "**/vendor-wardley*.js",
            "**/bundle-stats.html",
          ],
          modifyURLPrefix: {
            "": "/",
          },
          additionalManifestEntries: [
            { url: "/dashboard.css", revision: null },
          ],
          navigateFallback: "/index.html",
          // Only dashboard SPA navigations use navigateFallback — never hijack marketing `/`.
          navigateFallbackAllowlist: [/^\/dashboard\//],
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/auth(?:\/|$)/,
            /^\/auth\/login(?:\/|$)/,
            /^\/oauth\//,
            /^\/onboarding/,
          ],
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.method !== "GET" ||
                url.pathname.startsWith("/api/") ||
                url.pathname.startsWith("/auth/") ||
                url.pathname.startsWith("/oauth/"),
              handler: "NetworkOnly",
            },
            {
              urlPattern: ({ url }) =>
                /\/api\/agent\/(chat|plan)/i.test(url.pathname),
              handler: "NetworkOnly",
            },
            {
              /** Stable chunk URLs (XTermShell.js, etc.) — never serve stale JS from runtime cache. */
              urlPattern: ({ url }) =>
                url.pathname.startsWith("/") && url.pathname.endsWith(".js"),
              handler: "NetworkOnly",
            },
            {
              urlPattern: ({ url }) => url.origin.includes("fonts.gstatic.com"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "iam-fonts-v1",
                expiration: {
                  maxEntries: 24,
                  maxAgeSeconds: 365 * 24 * 60 * 60,
                },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.pathname === "/dashboard.css" ||
                (url.pathname.startsWith("/") && url.pathname.endsWith(".css")),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "iam-dashboard-css-v1",
                expiration: {
                  maxEntries: 32,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
      {
        name: "restore-dashboard-shell-css-href",
        apply: "build",
        transformIndexHtml: {
          order: "post",
          handler(html) {
            return html
              .replaceAll("/dashboard.css", "/dashboard.css")
              .replaceAll("dashboard2.css", "dashboard.css");
          },
        },
      },
      {
        name: "iam-pwa-root-manifest-link",
        apply: "build",
        enforce: "post",
        transformIndexHtml: {
          order: "post",
          handler(html) {
            let out = html.replace(
              "/manifest.webmanifest",
              "/manifest.webmanifest",
            );
            if (!out.includes('name="theme-color"')) {
              out = out.replace(
                '<link rel="manifest"',
                '<meta name="theme-color" content="#2dd4bf" />\n  <link rel="manifest"',
              );
            }
            if (!out.includes("apple-touch-icon")) {
              out = out.replace(
                '<link rel="manifest"',
                '<link rel="apple-touch-icon" sizes="180x180" href="/pwa/apple-touch-icon.png" />\n  <link rel="manifest"',
              );
            }
            if (!out.includes("apple-mobile-web-app-capable")) {
              out = out.replace(
                "<head>",
                '<head>\n  <meta name="apple-mobile-web-app-capable" content="yes" />\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\n  <meta name="apple-mobile-web-app-title" content="IAM" />',
              );
            }
            return out;
          },
        },
      },
      {
        name: "iam-purge-stale-dashboard-js-cache",
        apply: "build",
        enforce: "post",
        transformIndexHtml(html) {
          if (html.includes("iam-purge-stale-dashboard-js-cache")) return html;
          const purge =
            '<script id="iam-purge-stale-dashboard-js-cache">try{var m=document.querySelector(\'meta[name="iam-cache-bust"]\');var n=m&&m.getAttribute("content");var k="iam_sw_cache_bust";var p=localStorage.getItem(k);if(n&&p&&p!==n&&"caches"in window){sessionStorage.removeItem("iam_chunk_drift_reload");if(n){try{sessionStorage.removeItem("iam_chunk_drift_reload_"+n);}catch(e0){}}caches.keys().then(function(ns){return Promise.all(ns.map(function(name){if(/^iam-dashboard-js-v/.test(name)||/^workbox-precache-/.test(name)||/^workbox-precache-v/.test(name))return caches.delete(name);}));}).then(function(){if("serviceWorker"in navigator){navigator.serviceWorker.getRegistration("/").then(function(reg){if(reg&&reg.waiting)reg.waiting.postMessage({type:"SKIP_WAITING"});if(reg)reg.update();});}});}if(n)localStorage.setItem(k,n);}catch(e){}</script>';
          return html.replace(
            /<script type="module" crossorigin src="\/static\/dashboard\/app\/dashboard\.js/,
            `${purge}\n  <script type="module" crossorigin src="/dashboard.js`,
          );
        },
      },
      {
        name: "defer-excalidraw-css-from-boot",
        apply: "build",
        enforce: "post",
        transformIndexHtml(html) {
          return html.replace(
            /\s*<link[^>]*href="[^"]*vendor-excalidraw\.css"[^>]*>\s*/gi,
            "\n",
          );
        },
      },
      {
        name: "relocate-excalidraw-css-asset",
        apply: "build",
        enforce: "post",
        generateBundle(_options, bundle) {
          for (const [fileName, item] of Object.entries(bundle)) {
            if (item.type !== "asset" || !fileName.endsWith(".css")) continue;
            const src =
              typeof item.source === "string"
                ? item.source
                : Buffer.from(item.source as Uint8Array).toString("utf8");
            if (!src.includes(".excalidraw")) continue;
            delete bundle[fileName];
            this.emitFile({
              type: "asset",
              fileName: "assets/vendor-excalidraw.css",
              source: src,
            });
            break;
          }
        },
      },
      {
        name: "merge-dashboard-entry-css",
        apply: "build",
        enforce: "post",
        generateBundle(_options, bundle) {
          const parts: Array<{ name: string; source: string }> = [];
          for (const [fileName, item] of Object.entries(bundle)) {
            if (item.type !== "asset" || !fileName.endsWith(".css")) continue;
            if (fileName !== "dashboard.css" && fileName !== "dashboard2.css")
              continue;
            if (/excalidraw/i.test(fileName)) continue;
            const src = item.source;
            parts.push({
              name: fileName,
              source:
                typeof src === "string"
                  ? src
                  : Buffer.from(src).toString("utf8"),
            });
            delete bundle[fileName];
          }
          if (!parts.length) return;
          parts.sort((a, b) =>
            a.name === "dashboard.css"
              ? -1
              : b.name === "dashboard.css"
                ? 1
                : 0,
          );
          const merged = parts.map((p) => p.source).join("\n");
          this.emitFile({
            type: "asset",
            fileName: "dashboard.css",
            source: merged,
          });
        },
      },
      {
        name: "rewrite-dashboard2-css-refs",
        apply: "build",
        enforce: "post",
        renderChunk(code) {
          if (!code.includes("dashboard2.css")) return null;
          return code.replaceAll("dashboard2.css", "dashboard.css");
        },
        generateBundle(_options, bundle) {
          for (const item of Object.values(bundle)) {
            if (item.type === "chunk" && item.code.includes("dashboard2.css")) {
              item.code = item.code.replaceAll(
                "dashboard2.css",
                "dashboard.css",
              );
            } else if (
              item.type === "asset" &&
              typeof item.source === "string" &&
              item.source.includes("dashboard2.css")
            ) {
              item.source = item.source.replaceAll(
                "dashboard2.css",
                "dashboard.css",
              );
            }
          }
        },
        writeBundle(options, bundle) {
          const outDir = options.dir || path.resolve(__dirname, "dist");
          for (const fileName of Object.keys(bundle)) {
            if (!/\.(?:js|html|css)$/.test(fileName)) continue;
            const filePath = path.join(outDir, fileName);
            const raw = fs.readFileSync(filePath, "utf8");
            if (!raw.includes("dashboard2.css")) continue;
            fs.writeFileSync(
              filePath,
              raw.replaceAll("dashboard2.css", "dashboard.css"),
              "utf8",
            );
          }
        },
      },
      ...(analyze
        ? [
            visualizer({
              filename: "dist/bundle-stats.html",
              gzipSize: true,
              brotliSize: true,
              open: false,
              template: "treemap",
            }),
          ]
        : []),
    ],
    resolve: {
      dedupe: ["react", "react-dom", "remotion", "@remotion/player"],
      alias: {
        "@": path.resolve(__dirname, "."),
        "@iam/frontend": path.resolve(repoRoot, "app/frontend"),
        "lucide-react": path.resolve(repoRoot, "node_modules/lucide-react"),
        "three/addons": path.resolve(
          repoRoot,
          "node_modules/three/examples/jsm",
        ),
        "three/examples": path.resolve(repoRoot, "node_modules/three/examples"),
        three: path.resolve(
          repoRoot,
          "node_modules/three/build/three.module.js",
        ),
      },
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-router-dom"],
      exclude: [
        "@excalidraw/excalidraw",
        "remotion",
        "@remotion/player",
        "mermaid",
      ],
    },
    build: {
      minify: true,
      sourcemap: mode !== "production",
      outDir: "dist",
      cssCodeSplit: true,
      chunkSizeWarningLimit: 600,
      modulePreload: {
        polyfill: false,
        resolveDependencies: (_filename, deps) =>
          deps.filter((dep) => !HEAVY_PRELOAD_RE.test(dep)),
      },
      dynamicImportVarsOptions: {
        warnOnError: false,
      },
      rollupOptions: {
        input: {
          dashboard: path.resolve(__dirname, "index.html"),
        },
        output: {
          entryFileNames: (chunk) => {
            return chunk.isEntry ? "dashboard.js" : "[name].js";
          },
          chunkFileNames: "[name].js",
          assetFileNames: (asset) => {
            if (!asset.name?.endsWith(".css")) return "[name][extname]";
            const originals = asset.names ?? [];
            const fromExcalidraw = originals.some(
              (n) => /[/\\]@excalidraw[/\\]/.test(n) || /excalidraw/i.test(n),
            );
            const name = asset.name ?? "";
            if (fromExcalidraw) return "assets/vendor-excalidraw[extname]";
            if (/LearnPage|learn\.css/i.test(name))
              return "assets/[name][extname]";
            const base = name.replace(/\.css$/i, "");
            if (
              base === "index" ||
              base === "style" ||
              base === "dashboard" ||
              base.startsWith("dashboard")
            ) {
              return "dashboard.css";
            }
            return "assets/[name][extname]";
          },
          manualChunks: manualChunkForNodeModule,
        },
      },
    },
  };
});
