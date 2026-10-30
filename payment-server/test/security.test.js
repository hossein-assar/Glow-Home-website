// Fixes from the security audit: the admin page only logs in (no sign-up),
// and nextval_order_code() is callable by the service role only — which is
// the only key its two callers use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const adminJs = read('../../admin/admin.js');
const adminHtml = read('../../admin/index.html');

test('the admin login screen only logs in: no sign-up link, mode or call', () => {
  assert.doesNotMatch(adminJs, /signUp\s*\(/);
  assert.doesNotMatch(adminJs, /isSignupMode|toggle-signup/);
  assert.doesNotMatch(adminHtml, /toggle-signup|ثبت‌نام|ثبت نام/);
  assert.doesNotMatch(adminJs, /ثبت‌نام|ثبت نام/);
  assert.match(adminJs, /await sb\.auth\.signInWithPassword\(\{ email, password \}\)/);
  assert.match(adminHtml, /<button class="btn" id="btn-signin"[^>]*>ورود<\/button>/);
});

test('migration-lock-order-code.sql revokes from everyone but service_role and fixes search_path', () => {
  const original = read('../../supabase/migration-order-code-sequence.sql');
  assert.match(original, /create or replace function nextval_order_code\(\)\s*returns bigint/); // real signature: no arguments
  const sql = read('../../supabase/migration-lock-order-code.sql')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  assert.match(sql, /revoke execute on function public\.nextval_order_code\(\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.nextval_order_code\(\) to service_role;/);
  assert.match(sql, /alter function public\.nextval_order_code\(\) set search_path = public;/);
  assert.match(sql, /has_function_privilege\(r\.rolname, 'public\.nextval_order_code\(\)', 'execute'\)/);
  assert.match(sql, /'anon', 'authenticated', 'service_role'/);
});

test('nextval_order_code is only called by the payment server, with the service-role key', () => {
  // api/orders.js no longer takes orders: no Supabase client, no key, no order codes.
  const orders = read('../../api/orders.js');
  assert.doesNotMatch(orders, /createClient|SUPABASE_SERVICE_ROLE_KEY|nextval_order_code|supabase-js/);

  // payment-server: one client, from config.supabaseServiceRoleKey = SUPABASE_SERVICE_ROLE_KEY
  const db = read('../src/db.js');
  assert.equal([...db.matchAll(/createClient\(/g)].length, 1);
  assert.match(db, /createClient\(supabaseUrl, serviceRoleKey,/);
  assert.match(db, /sb\.rpc\('nextval_order_code'\)/);
  assert.match(read('../src/config.js'), /supabaseServiceRoleKey: required\('SUPABASE_SERVICE_ROLE_KEY'\)/);
  assert.match(read('../src/server.js'), /createDb\(\{ supabaseUrl: config\.supabaseUrl, serviceRoleKey: config\.supabaseServiceRoleKey \}\)/);

  // Nothing in the browser code calls it.
  for (const file of ['../../app.js', '../../admin/admin.js', '../../data.js', '../../supabase-config.js']) {
    assert.doesNotMatch(read(file), /nextval_order_code/, file);
  }
  // No server function on the site calls it.
  for (const f of readdirSync(new URL('../../api/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(read('../../api/' + f), /nextval_order_code/, f);
  }
});
