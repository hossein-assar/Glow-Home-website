// Entry point: node src/server.js (pm2: ecosystem.config.cjs).

import { createApp, log } from './app.js';
import { loadConfig, startupLogFields } from './config.js';
import { createDb } from './db.js';
import { createPaidNotifier, emailConfigured, missingEmailVars } from './email.js';
import { createZarinpalClient } from './zarinpal.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  // Config errors name the variable, never its value.
  console.error(`Config error: ${err.message}`);
  process.exit(1);
}

const db = createDb({ supabaseUrl: config.supabaseUrl, serviceRoleKey: config.supabaseServiceRoleKey });

// Paid-order email: optional. Missing key or recipient → one line now, then
// every paid order simply sends nothing (names only, never values).
if (!emailConfigured()) log('info', 'email.disabled', { missing: missingEmailVars() });

const app = createApp({
  config,
  db,
  zarinpal: createZarinpalClient({ baseUrl: config.zarinpal.baseUrl, merchantId: config.zarinpal.merchantId }),
  notifyPaid: createPaidNotifier({ db, logger: log }),
});

// Bind to localhost only — nginx terminates TLS and proxies to this port.
app.listen(config.port, '127.0.0.1', () => {
  log('info', 'server.started', startupLogFields(config));
});
