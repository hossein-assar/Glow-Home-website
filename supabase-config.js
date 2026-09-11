// Supabase project connection details.
// The publishable key below is meant to be public — it only ever grants
// exactly the access your Row Level Security policies allow (see
// supabase/schema.sql). Never put the "secret" key here or in any file
// that ships to the browser.

const SUPABASE_URL = 'https://sgfoesnpodvwyzlxfhtq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A27vHVa_NH46_BdUbwSZXQ_wWSHebBz';

function getSupabaseClient() {
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
