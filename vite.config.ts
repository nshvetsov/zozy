import { defineConfig } from "vite";

const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["sql.js"],
  },
  plugins: [
    {
      name: "local-source-html-proxy",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/__source_html")) {
            next();
            return;
          }
          try {
            const origin = req.headers.origin ?? "http://localhost";
            const requestUrl = new URL(req.url, origin);
            const targetUrl = requestUrl.searchParams.get("url");
            if (!targetUrl) {
              res.statusCode = 400;
              res.setHeader("content-type", "text/plain; charset=utf-8");
              res.end("Missing 'url' query parameter");
              return;
            }
            const response = await fetch(targetUrl, {
              signal:
                typeof AbortSignal !== "undefined" &&
                typeof (AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout === "function"
                  ? (AbortSignal as { timeout: (ms: number) => AbortSignal }).timeout(15000)
                  : undefined,
              redirect: "follow",
            });
            if (!response.ok) {
              res.statusCode = response.status;
              res.setHeader("content-type", "text/plain; charset=utf-8");
              res.end(`Source fetch failed: HTTP ${response.status}`);
              return;
            }
            const html = await response.text();
            res.statusCode = 200;
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(html);
          } catch (error) {
            res.statusCode = 502;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end(`Source fetch failed: ${(error as Error)?.message ?? "unknown"}`);
          }
        });
      },
    },
  ],
});
