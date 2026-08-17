import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SUPABASE_AUTH_COOKIE_NAME,
  SUPABASE_COOKIE_ENCODING,
} from '@/lib/supabase-cookie-config';

declare global {
  interface Window {
    __SUPABASE_CONFIG__?: {
      url: string;
      anonKey: string;
    };
  }
}

const SUPABASE_CONFIG_READY_EVENT = 'supabase-config-ready';

let browserClient: SupabaseClient | null = null;

function waitForConfig(maxWait = 5000): Promise<boolean> {
  if (window.__SUPABASE_CONFIG__?.url && window.__SUPABASE_CONFIG__?.anonKey) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let resolved = false;

    const handler = () => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener(SUPABASE_CONFIG_READY_EVENT, handler);
        resolve(true);
      }
    };

    window.addEventListener(SUPABASE_CONFIG_READY_EVENT, handler);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener(SUPABASE_CONFIG_READY_EVENT, handler);
        resolve(window.__SUPABASE_CONFIG__?.url && window.__SUPABASE_CONFIG__?.anonKey ? true : false);
      }
    }, maxWait);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient === null) {
    const config = window.__SUPABASE_CONFIG__;

    if (!config || !config.url || !config.anonKey) {
      throw new Error(
        'Supabase config not found. Make sure SupabaseConfigProvider is included in your layout.tsx and use useSupabaseConfig() to wait for config to be ready.',
      );
    }

    browserClient = createBrowserClient(config.url, config.anonKey, {
      cookieEncoding: 'base64url',
      cookieOptions: {
        name: SUPABASE_AUTH_COOKIE_NAME,
        path: '/',
        sameSite: 'lax',
        secure: window.location.protocol === 'https:',
        httpOnly: false,
      },
      cookies: { encode: SUPABASE_COOKIE_ENCODING },
    });
  }

  return browserClient;
}

async function getSupabaseBrowserClientWithRetry(maxRetries = 5, retryInterval = 1000): Promise<SupabaseClient> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return getSupabaseBrowserClient();
    } catch {
      if (i < maxRetries - 1) {
        await sleep(retryInterval);
      }
    }
  }
  return getSupabaseBrowserClient();
}

async function getSupabaseBrowserClientAsync(): Promise<SupabaseClient> {
  if (browserClient !== null) {
    return browserClient;
  }

  const ready = await waitForConfig();
  if (!ready) {
    throw new Error(
      'Supabase config not found after waiting. Make sure SupabaseConfigProvider is included in your layout.tsx',
    );
  }

  return getSupabaseBrowserClient();
}

export { getSupabaseBrowserClient, getSupabaseBrowserClientWithRetry, getSupabaseBrowserClientAsync };
