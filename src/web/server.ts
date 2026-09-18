import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { env } from "../config/env";
import { authRouter } from "./routes/auth";
import { apiRouter } from "./routes/api";

// In dev, the dashboard is served separately by Vite (client/vite.config.ts
// proxies /api and /gift-thumbnails back to this server). In production
// there's no separate Vite server — Railway exposes exactly one port — so
// this same Express app serves the built dashboard too, whenever a build
// output is present. Checking for the directory (rather than trusting
// NODE_ENV) means this adapts correctly either way without extra config.
const CLIENT_DIST_DIR = path.resolve(__dirname, "../../client/dist");
const hasClientBuild = fs.existsSync(path.join(CLIENT_DIST_DIR, "index.html"));

export function createWebServer() {
  const app = express();
  app.use(cors({ origin: env.webPublicUrl }));
  app.use(express.json());

  app.use("/api/auth", authRouter);
  app.use("/api", apiRouter);
  app.use(
    "/gift-thumbnails",
    express.static(env.giftThumbnailsDir, { maxAge: "7d", immutable: true })
  );

  if (hasClientBuild) {
    app.use(express.static(CLIENT_DIST_DIR));
    // SPA fallback: any non-API, non-asset route resolves to index.html so
    // client-side routing (/, /login) works on a hard refresh or direct link.
    // An unmatched /api/* or /gift-thumbnails/* path gets a real 404 instead
    // of silently returning the dashboard's HTML.
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/gift-thumbnails/")) {
        return res.status(404).json({ error: "Not found" });
      }
      res.sendFile(path.join(CLIENT_DIST_DIR, "index.html"));
    });
  } else {
    console.warn(
      "[web] No client build found at client/dist — run `npm run build` for the dashboard to be served. API-only for now."
    );
  }

  return app;
}

export function startWebServer() {
  const app = createWebServer();
  // Explicit 0.0.0.0: required to be reachable inside a container on
  // platforms like Railway, not just from localhost.
  app.listen(env.webPort, "0.0.0.0", () => {
    console.log(`[web] listening on 0.0.0.0:${env.webPort} (client build served: ${hasClientBuild})`);
  });
  return app;
}
