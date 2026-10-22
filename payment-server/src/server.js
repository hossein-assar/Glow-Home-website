// Entry point: node src/server.js (pm2: ecosystem.config.cjs).

import { createApp, log } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createZarinpalClient } from './zarinpal.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  // Config errors name the variable, never its value.
  console.error(`Config error: ${err.message}`);
  process.exit(1);
}

const app = createApp({
  config,
  db: createDb({ supabaseUrl: config.supabaseUrl, serviceRoleKey: config.supabaseServiceRoleKey }),
  zarinpal: createZarinpalClient({ baseUrl: config.zarinpal.baseUrl, merchantId: config.zarinpal.merchantId }),
});

// Bind to localhost only — nginx terminates TLS and proxies to this port.
app.listen(config.port, '127.0.0.1', () => {
  log('info', 'server.started', { port: config.port, zarinpal_mode: config.zarinpal.mode, callback_url: config.callbackUrl });
});
