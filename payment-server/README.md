# Glow Home payment server (ZarinPal)

A small Node 22 server that runs on the Iranian VPS, because ZarinPal only
accepts payment requests from a registered server IP. The static site on
Vercel still does everything else. Pay-at-door and card-to-card orders still
go through `api/orders.js`.

## Flow

1. The storefront (when `ONLINE_PAYMENT.enabled` is true in `data.js` and the
   customer picks «درگاه پرداخت آنلاین») POSTs the cart to
   `POST /api/checkout`.
2. The server re-prices everything from Supabase. Client prices are ignored,
   out-of-stock products are rejected, and shipping stays pay-at-door. It then
   inserts the order as `pending_payment`, calls ZarinPal `request.json`,
   saves the Authority, and returns `{ ok, code, url }`. `url` is the
   StartPay page.
3. ZarinPal sends the customer back to the `callback_url` (see
   [Callback URL](#callback-url)), which ends at
   `GET /api/verify?Authority=…&Status=…` on this server. The order is
   looked up by the saved Authority only. On `Status=OK` the server calls
   `verify.json` with the stored total, and on code 100/101 it calls the SQL
   function `mark_order_paid` (idempotent). Then it redirects to
   `PUBLIC_SITE_URL/#/payment/<code>/<ok|failed>`, which is an
   informational page only. `/track` shows the real status.

### Callback URL

Production ZarinPal only accepts a `callback_url` on the gateway's
registered domain (`glow-home.ir`). Any other host is rejected with «دسترسی از
این دامنه مجاز نمی‌باشد…». The sandbox doesn't check this.

- `CALLBACK_URL` unset: the callback is `PUBLIC_API_URL/api/verify` (this
  server directly). Fine for sandbox.
- `CALLBACK_URL=https://glow-home.ir/api/pay-callback` (production): ZarinPal
  sends the customer to the shop's Vercel function `api/pay-callback.js`.
  It accepts only `Authority` (letters and digits, up to 40 characters) and
  `Status` (`OK` or `NOK`), drops every other parameter, and answers with a
  303 to the fixed URL `https://pay.glow-home.ir/api/verify?Authority=…&Status=…`.
  Bad input gets 400, and methods other than GET get 405.

The full chain is: ZarinPal → `glow-home.ir/api/pay-callback` →
`pay.glow-home.ir/api/verify` → `glow-home.ir/#/payment/<code>/<ok|failed>`.
The verify host is hardcoded in `api/pay-callback.js`. If the payment
server's domain ever changes, change it there too.

The callback actually used is printed at startup in the `server.started`
log line (`callback_url`).

| Endpoint | |
|---|---|
| `GET /health` | `{ "ok": true }`. Instant, never touches Supabase: for uptime monitors. |
| `GET /health/deep` | One tiny Supabase read, timed: `{ "ok": true, "supabase": "ok" \| "slow", "ms": … }` (slow from 1.5 s), or 503 `{ "ok": false, "supabase": "failed", "ms": … }` on an error or after 5 s (the reason is in the log, `health.supabase_failed`). For a person checking the route, not for monitors. 10 requests / min / IP. |
| `POST /api/checkout` | CORS: `https://glow-home.ir`, `https://www.glow-home.ir` only. 16 KB body limit. 10 requests / 10 min / IP. |
| `GET /api/verify` | ZarinPal callback. 30 requests / min / IP. Always redirects to the site. |

### Amount unit

The site stores Toman. ZarinPal is sent **Rial** (`× 10`) with
`currency: "IRR"`. `verify.json` has no currency field and the docs don't say
which unit it assumes, so the server uses Rial for both calls. The constants
are `RIAL_PER_TOMAN` / `ZARINPAL_CURRENCY` in `src/config.js`. The exact Rial
amount sent is stored in `orders.payment_amount_rial`.

### Order statuses

`pending_payment` → `paid` (only via `mark_order_paid`) or `payment_failed`.
`payment_error` holds the reason / ZarinPal code for the admin. Abandoned
checkouts stay `pending_payment`; no cleanup job runs.

### Supabase route: the VPS uses `https://glow-home.ir/sb`

Direct calls from the Iranian VPS to `*.supabase.co` stall: reads came
back, but writes (`order_code`, saving the Authority) hung until nginx gave
up, so checkout never reached ZarinPal. The VPS therefore talks to Supabase
through the shop's own proxy (the `/sb` rewrites in `vercel.json`, the same
route the browser uses):

```
SUPABASE_URL=https://glow-home.ir/sb
```

- This lives only in the VPS's `payment-server/.env`, which is **not in
  git**. `.env.bak` next to it holds the previous value (the direct
  `supabase.co` URL), for going back if the proxy is ever the problem.
- The `server.started` log line shows the route in use (`supabase_host`,
  `supabase_path`: `glow-home.ir` and `/sb`), never a key.
- `GET /health/deep` checks it: `"supabase":"ok"` with a time in ms.
- If `/sb` breaks (e.g. `vercel.json` changes), checkout breaks too. Keep
  the three `/sb/{rest,auth,storage}/v1` rewrites.

Timeouts: every Supabase request is aborted after 10 s, every checkout step
(Supabase or ZarinPal call) is limited to 10 s and the whole request to
25 s. Calls that are safe to repeat (reads, saving the Authority, the order
number) get one more try after 0.5 s, each try at most 4.5 s; creating the
order is never repeated, so a lost answer can't become a second order (see
`src/db.js`). Any failure is logged as `checkout.failed` / `verify.failed`
with the step name.

### VPS env checklist

`payment-server/.env` on the VPS (`chmod 600`, never committed; template:
`.env.example`). Names only:

| Variable | Required | Note |
|---|---|---|
| `SUPABASE_URL` | yes | `https://glow-home.ir/sb` on the VPS (see above) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase secret / service_role key |
| `ZARINPAL_MERCHANT_ID` | yes | 36-character UUID |
| `ZARINPAL_MODE` | no (default `sandbox`) | `production` when live |
| `PUBLIC_SITE_URL` | yes | the shop, `https://glow-home.ir` |
| `PUBLIC_API_URL` | yes | this server, `https://pay.glow-home.ir` |
| `CALLBACK_URL` | production | `https://glow-home.ir/api/pay-callback` |
| `PORT` | no (default `3000`) | must match nginx `proxy_pass` |

After editing `.env`: `pm2 restart glow-payment --update-env`, then check
the `server.started` line and `/health/deep`.

## Local development (sandbox)

```bash
cd payment-server
cp .env.example .env      # sandbox: any UUID works as ZARINPAL_MERCHANT_ID
npm ci
npm test                  # unit + route tests, no network, no database
npm start
```

In sandbox mode `PUBLIC_SITE_URL` / `PUBLIC_API_URL` may be
`http://localhost:…`. In production they must be `https://`.

`npm test` also fails if the discount codes / shipping rules in
`src/pricing.js`, `api/orders.js` and `data.js` drift apart.

## Deploy (Ubuntu 24.04)

Assumes a DNS record such as `pay.glow-home.ir` points at the VPS, and that
the VPS IP and the domain are registered in the ZarinPal panel. Run these as
a normal sudo user, not root.

**Before the first deploy:** run `supabase/migration-online-payment.sql` in
the Supabase SQL Editor.

### 1. One-time server setup

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx certbot python3-certbot-nginx
node -v                                   # v22.x

sudo npm install -g pm2

# Code
sudo mkdir -p /opt/glow-home && sudo chown "$USER" /opt/glow-home
git clone <YOUR-REPO-URL> /opt/glow-home
cd /opt/glow-home/payment-server
npm ci --omit=dev

# Secrets — create by hand, never commit
cp .env.example .env
nano .env                                 # real values; ZARINPAL_MODE=sandbox first
chmod 600 .env
```

nginx reverse proxy (`/etc/nginx/sites-available/glow-payment`):

```nginx
server {
    listen 80;
    server_name pay.glow-home.ir;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 32k;
    }
}
```

`X-Forwarded-For` is set to `$remote_addr` on purpose, not appended to. That
way a client can't spoof its IP to get around the rate limit.

```bash
sudo ln -s /etc/nginx/sites-available/glow-payment /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pay.glow-home.ir  # HTTPS (ZarinPal needs an https callback)
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

### 2. Start with pm2

```bash
cd /opt/glow-home/payment-server
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd                       # run the command it prints, once
curl -s https://pay.glow-home.ir/health   # {"ok":true}
pm2 logs glow-payment --lines 50          # "server.started" … zarinpal_mode
```

### 3. Updating

(The live VPS checkout is in `~/glow-home`, not `/opt/glow-home`.)

```bash
cd /opt/glow-home
git pull
cd payment-server
npm ci --omit=dev
pm2 restart glow-payment --update-env
pm2 save
curl -s https://pay.glow-home.ir/health
curl -s https://pay.glow-home.ir/health/deep   # "supabase":"ok"
```

### 4. Going live

1. Test the whole flow in sandbox on the VPS first (`ZARINPAL_MODE=sandbox`).
2. Set `ZARINPAL_MODE=production`, the real `ZARINPAL_MERCHANT_ID` and
   `CALLBACK_URL=https://glow-home.ir/api/pay-callback` in `.env`, then
   `pm2 restart glow-payment --update-env`. The shop must already be deployed
   with `api/pay-callback.js`.
3. In `data.js` set `ONLINE_PAYMENT.apiUrl` to the server's https URL and
   `enabled: true`, then deploy the site.

### Logs

`pm2 logs glow-payment`. One JSON line per event, with no merchant id, keys,
phone numbers or addresses. Search for `"level":"error"`. These events need a
human:

- `verify.mark_paid_failed_after_verify`: ZarinPal confirmed the money but
  the DB write failed. Repeating the callback fixes it.
- `verify.paid_but_not_markable` / `verify.unexpected_status`: the order is
  cancelled or not in a payable state. Check it in the ZarinPal panel and
  refund it manually if needed.
- `checkout.failed` / `verify.failed`: the `step` field names what failed
  or timed out (`fetch_products`, `order_code`, `create_order`,
  `zarinpal_request`, `save_authority`, `find_order`, `zarinpal_verify`, …).
  Repeated Supabase steps failing: check `/health/deep` and `SUPABASE_URL`.
- `zarinpal.request_failed` with code `-10`: wrong merchant id, or the VPS IP
  isn't registered at ZarinPal.
- `zarinpal.request_failed` with code `-14`, or the «دسترسی از این دامنه
  مجاز نمی‌باشد» page: the callback isn't on the registered domain. Set
  `CALLBACK_URL` (see [Callback URL](#callback-url)).
