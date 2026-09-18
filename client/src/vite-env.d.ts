/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the backend API, e.g. https://your-backend.up.railway.app.
   * Leave unset for same-origin/dev-proxy setups (local dev, or a single
   * unified service that serves both the API and this dashboard) — requests
   * then just go to relative "/api" paths.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
