/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin only (no path), e.g. `https://api.example.com` — requests go to `{origin}/api/v1`. Empty = same host / Vite proxy. */
  readonly VITE_API_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
