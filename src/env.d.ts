/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface Window {
  turnstile?: {
    reset: () => void;
  };
}

type Runtime = import('@astrojs/cloudflare').Runtime<{
  SUBMISSIONS_KV: KVNamespace;
  TURNSTILE_SECRET_KEY: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
}>;

declare namespace App {
  interface Locals extends Runtime {}
}
