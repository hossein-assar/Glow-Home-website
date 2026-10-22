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
3. ZarinPal sends the customer back to `GET /api/verify?Authority=…&Status=…`.
   The order is looked up by the saved Authority only. On `Status=OK` the
   server calls `verify.json` with the stored total, and on code 100/101 it
   calls the SQL function `mark_order_paid` (idempotent). Then it redirects to
   `PUBLIC_SITE_URL/#/payment/<code>/<ok|failed>`, which is an
   informational page only. `/track` shows the real status.

| Endpoint | |
|---|---|
| `GET /health` | `{ "ok": true }` |
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

```bash
cd /opt/glow-home
git pull
cd payment-server
npm ci --omit=dev
pm2 restart glow-payment --update-env
pm2 save
curl -s https://pay.glow-home.ir/health
```

### 4. Going live

1. Test the whole flow in sandbox on the VPS first (`ZARINPAL_MODE=sandbox`).
2. Set `ZARINPAL_MODE=production` and the real `ZARINPAL_MERCHANT_ID` in
   `.env`, then `pm2 restart glow-payment --update-env`.
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
- `zarinpal.request_failed` with code `-10`: wrong merchant id, or the VPS IP
  isn't registered at ZarinPal.
