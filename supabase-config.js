// Supabase project connection details.
// The publishable key below is meant to be public — it only ever grants
// exactly the access your Row Level Security policies allow (see
// supabase/schema.sql). Never put the "secret" key here or in any file
// that ships to the browser.

const SUPABASE_URL = 'https://sgfoesnpodvwyzlxfhtq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A27vHVa_NH46_BdUbwSZXQ_wWSHebBz';

// supabase.co is blocked in Iran without a VPN, so the browser talks to
// Supabase through our own domain: vercel.json rewrites /sb/rest/v1,
// /sb/auth/v1 and /sb/storage/v1 to SUPABASE_URL. location.origin keeps it
// working on www and on preview deployments too.
const SUPABASE_PROXY_URL = location.origin + '/sb';

// The session key the client used before the proxy (it is derived from the
// URL's host), so admins stay logged in and it is the same on every host.
const SUPABASE_AUTH_STORAGE_KEY = 'sb-sgfoesnpodvwyzlxfhtq-auth-token';

function getSupabaseClient() {
  return window.supabase.createClient(SUPABASE_PROXY_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storageKey: SUPABASE_AUTH_STORAGE_KEY },
  });
}

const SUPABASE_STORAGE_PREFIX = SUPABASE_URL + '/storage/v1/';
const PROXY_STORAGE_PREFIX = SUPABASE_PROXY_URL + '/storage/v1/';

/** Photo URL to show in the page: a supabase.co storage URL goes through
 * /sb; anything else (relative images/… paths, /sb URLs, other hosts) is
 * returned unchanged. Null/empty gives ''. */
function proxiedPhotoUrl(url) {
  const s = String(url ?? '').trim();
  return s.startsWith(SUPABASE_STORAGE_PREFIX) ? PROXY_STORAGE_PREFIX + s.slice(SUPABASE_STORAGE_PREFIX.length) : s;
}

/** Photo URL to store in the database: the canonical supabase.co form, so
 * stored URLs never depend on the host the admin panel was opened on. */
function canonicalPhotoUrl(url) {
  const s = String(url ?? '').trim();
  return s.startsWith(PROXY_STORAGE_PREFIX) ? SUPABASE_STORAGE_PREFIX + s.slice(PROXY_STORAGE_PREFIX.length) : s;
}
