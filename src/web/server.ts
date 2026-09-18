import express from "express";
import cors from "cors";
import { env } from "../config/env";
import { authRouter } from "./routes/auth";
import { apiRouter } from "./routes/api";

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

  return app;
}

export function startWebServer() {
  const app = createWebServer();
  app.listen(env.webPort, () => {
    console.log(`[web] API server listening on http://localhost:${env.webPort}`);
  });
  return app;
}
