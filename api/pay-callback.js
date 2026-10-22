// GET /api/pay-callback
//
// ZarinPal's production gateway is bound to glow-home.ir and only accepts a
// callback_url on that domain, but payments are verified by the payment
// server on the Iranian VPS (payment-server/, GET /api/verify). This
// function is the hop in between: ZarinPal sends the customer here, and it
// forwards them to the payment server.
//
// It is NOT an open redirect: the destination is a fixed constant, only
// Authority and Status are read, both must match strict patterns, and every
// other query parameter is dropped. Anything else gets a 400.

const VERIFY_URL = 'https://pay.glow-home.ir/api/verify';

const AUTHORITY_RE = /^[A-Za-z0-9]{1,40}$/;
const STATUS_RE = /^(OK|NOK)$/;

function single(params, name) {
  const all = params.getAll(name);
  return all.length === 1 ? all[0] : null; // missing or repeated -> invalid
}

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Method not allowed');
    return;
  }

  // Parse the raw URL ourselves rather than trusting a pre-parsed query
  // object, so repeated parameters can't sneak through as arrays.
  const params = new URL(req.url || '/', 'https://glow-home.ir').searchParams;
  const authority = single(params, 'Authority');
  const status = single(params, 'Status');

  if (authority === null || status === null || !AUTHORITY_RE.test(authority) || !STATUS_RE.test(status)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('درخواست نامعتبر است.');
    return;
  }

  const location =
    `${VERIFY_URL}?Authority=${encodeURIComponent(authority)}&Status=${encodeURIComponent(status)}`;
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.end();
};
