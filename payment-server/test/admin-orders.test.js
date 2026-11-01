// Admin panel, orders tab (admin/admin.js, a browser script): the order
// card's shipping line, the sales-summary note, and the printable order
// («چاپ سفارش»). Runs the real functions, pulled out of the source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const adminJs = read('../../admin/admin.js');
const { COPY } = new Function(read('../../data.js') + '\nreturn { COPY };')();

const grab = (re) => {
  const m = adminJs.match(re);
  assert.ok(m, 'not found in admin/admin.js: ' + re);
  return m[0];
};
const fnSrc = (name) => grab(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));

const env = new Function(
  [
    grab(/const STATUS_LABEL = \{[\s\S]*?\n\};\n/),
    grab(/const UNPAID_ONLINE = [^\n]*\n/),
    grab(/const SHIPPING_LABEL = [^\n]*\n/),
    grab(/const SHOP_INSTAGRAM = [^\n]*\n/),
    grab(/const SHOP_SENDER_NAME = [^\n]*\n/),
    grab(/const SHOP_SENDER_PHONE = [^\n]*\n/),
    ...['money', 'escapeHtml', 'faNum', 'phoneDisplay', 'orderPaymentState', 'orderPrintHtml', 'orderCardHtml', 'paymentInfoHtml'].map(fnSrc),
    'return { orderPrintHtml, orderCardHtml, orderPaymentState, phoneDisplay, money, SHOP_INSTAGRAM, SHOP_SENDER_NAME, SHOP_SENDER_PHONE };',
  ].join('\n')
)();
const { orderPrintHtml, orderCardHtml, money } = env;
const fa = (n) => n.toLocaleString('fa-IR');

// A paid online order outside Tehran: two products, the packaging fee line.
const ORDER = {
  id: 'o-1',
  code: 'GH-1001',
  created_at: '2026-11-01T09:30:00Z',
  customer_name: 'سارا محمدی',
  phone: '09121234567',
  city: 'کرج',
  address: 'عظیمیه، خیابان مهران، کوچه ۴، پلاک ۱۲، واحد ۳',
  postcode: '3134567890',
  note: 'لطفاً قبل از ارسال تماس بگیرید',
  shipping_method: 'tipax',
  shipping_cost: 0,
  subtotal: 7600000,
  total: 7850000,
  status: 'paid',
  payment_method: 'zarinpal',
  paid_at: '2026-11-01T09:32:00Z',
  payment_ref_id: '50123456789',
  payment_card_pan: '502229******5995',
};
const ITEMS = [
  { product_id: 'p-gisoo', name_fa: 'گیسو (۱۲۰ سانتی‌متر) — شید گلدوزی', qty: 1, unit_price: 4200000 },
  { product_id: 'p-lale', name_fa: 'لاله', qty: 2, unit_price: 1700000 },
  { product_id: null, name_fa: 'هزینه بسته‌بندی', qty: 1, unit_price: 250000 },
];

// ---- order card ---------------------------------------------------------------

test('order card: the shipping line is the method name only — no amount, no «پس‌کرایه»', () => {
  for (const [method, label] of [['peyk', 'پیک تهران'], ['tipax', 'تیپاکس']]) {
    const html = orderCardHtml({ ...ORDER, shipping_method: method, shipping_cost: method === 'peyk' ? 90000 : 0 }, ITEMS);
    const line = html.match(/روش ارسال:[^<]*<\/div>/)[0];
    assert.equal(line, `روش ارسال: ${label}</div>`, method);
    assert.doesNotMatch(html, /پس‌کرایه/);
    assert.ok(!html.includes(money(90000)), 'no courier amount');
  }
  assert.doesNotMatch(adminJs, /SHIPPING_PAY_AT_DOOR|codShippingTotal|جدا از مبلغ سفارش/);
});

test('order card: the packaging fee is still its own line and the total includes it', () => {
  const html = orderCardHtml(ORDER, ITEMS);
  assert.ok(html.includes(`<span>هزینه بسته‌بندی × 1</span><span>${money(250000)}</span>`));
  assert.ok(html.includes(`<span>جمع کل</span><span>${money(7850000)}</span>`));
});

test('order card: a «چاپ سفارش» button next to the status select, wired to printOrder', () => {
  const html = orderCardHtml(ORDER, ITEMS);
  assert.match(html, /<\/select>\s*<button type="button" class="btn ghost" id="order-print-o-1"[^>]*>چاپ سفارش<\/button>/);
  assert.match(fnSrc('renderOrdersList'), /print\.addEventListener\('click', \(\) => printOrder\(o\.id\)\)/);
});

// ---- sales summary --------------------------------------------------------------

test('sales summary: only the note that revenue excludes the courier fee is left', () => {
  const summary = fnSrc('loadOrdersSummary');
  assert.match(summary, /\.select\('total, status'\)/);
  const note = summary.match(/<div style="margin-top:10px; font-size:12\.5px; color:#8a7d6e">\s*([\s\S]*?)\s*<\/div>`;/)[1];
  assert.equal(
    note,
    '«درآمد کل» و «میانگین ارزش سفارش» شامل هزینه‌ی پس‌کرایه (مثلاً پیک تهران) نمی‌شود — این مبلغ را مشتری نقداً به مأمور تحویل می‌دهد، نه از طریق سایت.'
  );
});

// ---- printable order --------------------------------------------------------------

test('print: the label and slip carry the code, name, mobile, address, city, postcode, method, notes', () => {
  const html = orderPrintHtml(ORDER, ITEMS);
  assert.match(html, /^<!doctype html>\n<html lang="fa" dir="rtl">/);
  assert.match(html, /@page \{ size: A4 portrait;/);
  assert.match(html, /@font-face \{ font-family: 'IRANSansX'; src: url\('\/fonts\/iransansx-400\.woff2'\)/, 'the site font');
  assert.ok(orderPrintHtml(ORDER, ITEMS, 'https://glow-home.ir').includes("url('https://glow-home.ir/fonts/iransansx-700.woff2')"), 'absolute with the origin');
  assert.match(html, /<span class="code ltr">GH-1001<\/span>/);
  assert.match(html, /<span>[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}، ساعت [۰-۹]{2}:[۰-۹]{2}<\/span>/, 'date and time in Persian digits');
  assert.match(html, /<span class="brand ltr">Glow Home<\/span><span class="doc">برگه سفارش<\/span>/);
  assert.match(html, /<div class="name">سارا محمدی<\/div>/);
  assert.ok(html.includes('موبایل: <span class="ltr">09121234567</span>'));
  assert.ok(html.includes(`نشانی: ${ORDER.address}`));
  assert.ok(html.includes('شهر: کرج'));
  assert.ok(html.includes('کد پستی: <span class="ltr">3134567890</span>'));
  assert.ok(html.includes('<div class="method">روش ارسال: تیپاکس</div>'));
  assert.ok(html.includes(`<b>توضیحات مشتری:</b> ${ORDER.note}`));
  assert.ok(html.includes('<div class="cut" aria-hidden="true"><span>✂</span></div>'));
  assert.match(html, /بسته‌بندی شد<span class="box"><\/span><\/span><span>ارسال شد<span class="box"><\/span>/);
  assert.ok(html.includes(`glow-home.ir · Instagram: @${COPY.instagram}`));
  assert.ok(html.includes('از خرید شما سپاسگزاریم'));
  // optional parts disappear when empty
  const bare = orderPrintHtml({ ...ORDER, postcode: '', note: '' }, ITEMS);
  assert.ok(!bare.includes('کد پستی') && !bare.includes('توضیحات مشتری'));
});

test('print: every product row, the packaging fee under the table, the total paid, the tracking code', () => {
  const html = orderPrintHtml(ORDER, ITEMS);
  const rows = [...html.matchAll(/<tr><td class="n">([^<]*)<\/td><td>([^<]*)<\/td><td class="n">([^<]*)<\/td><td class="num">([^<]*)<\/td><td class="num">([^<]*)<\/td><\/tr>/g)].map((m) => m.slice(1));
  assert.deepEqual(rows, [
    [fa(1), 'گیسو (۱۲۰ سانتی‌متر) — شید گلدوزی', fa(1), money(4200000), money(4200000)],
    [fa(2), 'لاله', fa(2), money(1700000), money(3400000)],
  ]);
  assert.ok(html.includes(`<div><span>جمع اقلام</span><span>${money(7600000)}</span></div>`));
  assert.ok(html.includes(`<div><span>هزینه بسته‌بندی</span><span>${money(250000)}</span></div>`));
  assert.ok(html.includes(`<div class="grand"><span>مبلغ پرداخت‌شده</span><span>${money(7850000)}</span></div>`));
  assert.ok(html.includes('پرداخت آنلاین — پرداخت‌شده — کد پیگیری: <span class="ltr">50123456789</span>'));
  assert.doesNotMatch(html, /تخفیف/, 'no discount line without a discount');
  assert.match(html, /tr \{ page-break-inside: avoid; break-inside: avoid; \}/);
  // Tehran: no fee line at all
  const tehran = orderPrintHtml({ ...ORDER, city: 'تهران', shipping_method: 'peyk', total: 7600000 }, ITEMS.slice(0, 2));
  assert.ok(!tehran.includes('هزینه بسته‌بندی'));
  assert.ok(tehran.includes('روش ارسال: پیک تهران'));
  assert.ok(!tehran.includes('پس‌کرایه') && !tehran.includes(money(90000)));
});

test('print: a discount shows as its own line', () => {
  const html = orderPrintHtml({ ...ORDER, discount_code: 'GLOW10', total: 7850000 - 760000 }, ITEMS);
  assert.ok(html.includes(`<div><span>تخفیف (<span class="ltr">GLOW10</span>)</span><span>−${money(760000)}</span></div>`));
});

test('print: name, address, notes and the other order fields are escaped — nothing injects HTML', () => {
  const evil = {
    ...ORDER,
    code: 'GH-1<i>',
    customer_name: '<script>alert(1)</script>',
    address: '"><img src=x onerror=alert(1)> \'q\'',
    note: '<b>bold</b> & "quotes" </div><script>x()</script>',
    city: '<u>c</u>',
    phone: '0912"><svg onload=1>',
    postcode: '<i>1</i>',
    payment_ref_id: '<x>',
    discount_code: '<y>',
  };
  const items = [{ product_id: 'p', name_fa: '<img src=y onerror=alert(2)>', qty: 1, unit_price: 1 }, { product_id: null, name_fa: '<fee>', qty: 1, unit_price: 1 }];
  const html = orderPrintHtml({ ...evil, total: 1 }, items);
  for (const raw of ['<script>', '<img src=x', '<img src=y', '<svg', '<u>', '<b>bold', '<i>', '<x>', '<y>', '<fee>', 'GH-1<i>', 'onerror=alert(1)>', '0912"']) {
    assert.ok(!html.includes(raw), 'raw: ' + raw);
  }
  for (const esc of ['&lt;script&gt;alert(1)&lt;/script&gt;', '&quot;&gt;&lt;img src=x onerror=alert(1)&gt; &#39;q&#39;', '&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;', '&lt;img src=y onerror=alert(2)&gt;']) {
    assert.ok(html.includes(esc), 'escaped: ' + esc);
  }
  assert.equal((html.match(/<script/gi) || []).length, 0, 'the page has no script at all');
  assert.equal((html.match(/<img /g) || []).length, 1, 'the only image is the watermark');
});

// The sender number as digits only, read from data.js — never typed here.
const SENDER_DIGITS = COPY.contactWhatsapp.replace(/\D/g, '');

test('print: no card number; the only phone numbers are the customer\'s and the sender\'s (never the old shop number)', () => {
  const html = orderPrintHtml(ORDER, ITEMS);
  assert.ok(!html.includes('502229') && !html.includes('5995') && !html.includes('******'), 'card number');
  assert.doesNotMatch(html, /کارت:|tel:|wa\.me|t\.me/);
  const latin = html.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660);
  const phones = [...latin.matchAll(/(?<![0-9])(?:\+98|0098|0)?[\s]?9[0-9]{2}[\s\-.]?[0-9]{3}[\s\-.]?[0-9]{4}(?![0-9])/g)]
    .map((m) => m[0].replace(/\D/g, '').replace(/^(0098|98|0)/, ''));
  assert.deepEqual(phones, [SENDER_DIGITS.slice(2), '9121234567'], 'the sender\'s number (top of the label), then the customer\'s mobile');
  // the old shop number (see old-phone-number.test.js), in any digit form
  const OLD = [9, 1, 9, 5, 8, 1, 9, 2, 0, 3];
  assert.doesNotMatch(latin, new RegExp(OLD.join('[\\s\\-.]*')));
});

test('print: the label reads sender → «گیرنده» + recipient box → notes → ✂, once each, for paid, pending and failed orders', () => {
  for (const o of [ORDER, { ...ORDER, status: 'pending_payment', paid_at: null, payment_ref_id: null }, { ...ORDER, status: 'payment_failed', paid_at: null }]) {
    const html = orderPrintHtml(o, ITEMS);
    // «فرستنده:» bold with its colon, a normal space, then the name and the number
    const sender = `<div class="sender"><b>فرستنده:</b> سحر راد — <span class="ltr">${env.phoneDisplay(env.SHOP_SENDER_PHONE)}</span></div>`;
    const order = ['<div class="block label-area">', sender, '<h2>گیرنده</h2>', '<div class="label">', '<div class="name">', '<div class="method">', '<div class="notes">', '<div class="cut"'];
    for (const part of order) assert.equal(html.split(part).length, 2, `once: ${part} (${o.status})`);
    const at = order.map((part) => html.indexOf(part));
    assert.ok(at.every((i, k) => k === 0 || i > at[k - 1]), `order (${o.status}): ${at}`);
    // the notes close the label area, and the cut line comes right after it
    assert.match(html, /<div class="notes">[^]*?<\/div>\n  <\/div>\n\n  <div class="cut"/);
  }
  assert.ok(!orderPrintHtml(ORDER, ITEMS).includes('ارسال به'), '«ارسال به» is gone');
  assert.ok(!adminJs.includes('ارسال به'));
  const css = orderPrintHtml(ORDER, ITEMS);
  assert.match(css, /\.sender \{ border: 1\.5px solid #000; padding: 1\.5mm 4mm; font-size: 12pt; \}/);
  assert.match(css, /\.label-area h2 \{ margin-top: 3mm; \}/, '3 mm from the sender box to the recipient block');
  assert.match(css, /\.label-area \{ position: relative; z-index: 1; background: #fff; \}/, 'white behind the label');
  assert.match(css, /\.sender b \{ font-size: 11pt; \}/);
  assert.match(css, /\.label \{[^}]*font-size: 13pt; \}/, 'the recipient block stays bigger');
  assert.match(css, /\.label \.name \{ font-size: 19pt;/);
});

test('print: the sender constants mirror data.js, and the spaced form is derived from them', () => {
  assert.equal(env.SHOP_SENDER_PHONE, COPY.contactWhatsapp);
  assert.equal(env.SHOP_SENDER_NAME, 'سحر راد');
  assert.equal(env.phoneDisplay(env.SHOP_SENDER_PHONE), `+98 ${SENDER_DIGITS.slice(2, 5)} ${SENDER_DIGITS.slice(5, 8)} ${SENDER_DIGITS.slice(8)}`);
  assert.equal(env.phoneDisplay('+989121234567'), '+98 912 123 4567');
  // the display form is never typed into admin.js — only the constant
  assert.ok(!adminJs.includes(env.phoneDisplay(env.SHOP_SENDER_PHONE)));
  assert.match(fnSrc('orderPrintHtml'), /phoneDisplay\(SHOP_SENDER_PHONE\)/);
});

test('print: the page keeps its parts, in order', () => {
  const html = orderPrintHtml(ORDER, ITEMS);
  const parts = ['class="head"', 'class="meta"', 'class="block label-area"', 'class="sender"', '<h2>گیرنده</h2>', 'class="label"', 'class="notes"', 'class="cut"', 'class="slip"', 'class="watermark"', '<h2>محتویات سفارش</h2>', '<table>', 'class="totals"', 'class="pay"', 'class="checks"', 'class="foot"'];
  const at = parts.map((p) => html.indexOf(p));
  assert.ok(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1])), 'order: ' + at);
  for (const p of parts) assert.equal(html.split(p).length, 2, 'once: ' + p);
});

test('print: the flower watermark — the storefront\'s motif, absolute URL on the origin, faint, forced to print, outside the label', () => {
  const html = orderPrintHtml(ORDER, ITEMS, 'https://glow-home.ir');
  assert.ok(html.includes('<img class="watermark" src="https://glow-home.ir/images/motif-flower.png" alt="" aria-hidden="true">'));
  assert.ok(orderPrintHtml(ORDER, ITEMS).includes('src="/images/motif-flower.png"'), 'root-relative without an origin');
  const rule = html.match(/\.watermark \{([^}]*)\}/)[1];
  assert.match(rule, /-webkit-print-color-adjust: exact; print-color-adjust: exact;/);
  assert.match(rule, /opacity: 0\.3;/, 'the motif PNG is itself ~42% opaque: 0.3 ≈ 0.12 on solid lines');
  assert.match(rule, /filter: grayscale\(1\);/);
  assert.match(rule, /position: absolute; z-index: 0;/);
  assert.match(html, /\.slip \{ position: relative; overflow: hidden; overflow: clip; \}/, 'clipped by the slip: it can never add a page');
  assert.match(html, /\.slip > \*:not\(\.watermark\) \{ position: relative; z-index: 1; \}/, 'the slip text sits above it');
  // inside the slip (after the ✂ line), never inside the label area
  const label = html.slice(html.indexOf('<div class="block label-area">'), html.indexOf('<div class="cut"'));
  assert.ok(!label.includes('watermark') && !label.includes('motif-flower'));
  assert.ok(html.indexOf('<div class="slip">') < html.indexOf('class="watermark"'));
  assert.doesNotMatch(html, /background(-image)?:\s*url\(/, 'not a CSS background');
  assert.ok(readFileSync(new URL('../../images/motif-flower.png', import.meta.url)).length < 400 * 1024, 'a small file');
});

test('print: waits for the font and the watermark, at most PRINT_WAIT_MS; a failed image is removed', () => {
  const print = fnSrc('printOrder');
  assert.match(adminJs, /\nconst PRINT_WAIT_MS = 3000;\n/);
  assert.match(print, /win\.document\.fonts && win\.document\.fonts\.ready/);
  assert.match(print, /querySelector\('\.watermark'\)/);
  assert.match(print, /img\.addEventListener\('load', resolve\)/);
  assert.match(print, /img\.addEventListener\('error', \(\) => \{\s*img\.remove\(\);\s*resolve\(\);/);
  assert.match(print, /setTimeout\(resolve, PRINT_WAIT_MS\)/);
  assert.match(print, /Promise\.race\(\[Promise\.all\(\[fonts, image\]\), timeout\]\)\.then\(\(\) => setTimeout\(print, 100\)\)/);
});

test('print: unpaid or failed online orders say «پرداخت‌نشده», never «پرداخت‌شده», and show no tracking code', () => {
  for (const status of ['pending_payment', 'payment_failed']) {
    const html = orderPrintHtml({ ...ORDER, status, paid_at: null, payment_ref_id: null }, ITEMS);
    assert.ok(html.includes('پرداخت آنلاین — پرداخت‌نشده'), status);
    assert.ok(html.includes(`<div class="grand"><span>مبلغ سفارش (پرداخت‌نشده)</span><span>${money(7850000)}</span></div>`), status);
    assert.ok(!html.includes('پرداخت‌شده'), status);
    assert.ok(!html.includes('کد پیگیری'), status);
  }
  // an unpaid status wins even if a stray ref_id is there
  assert.equal(env.orderPaymentState({ ...ORDER, status: 'payment_failed' }).paid, false);
  // older card-to-card orders: paid once marked paid or further along
  assert.equal(env.orderPaymentState({ status: 'pending', payment_method: null }).label, 'کارت به کارت — پرداخت‌نشده');
  assert.equal(env.orderPaymentState({ status: 'shipped', payment_method: null }).label, 'کارت به کارت — پرداخت‌شده');
});

test('print: built from the loaded order only — a new window, no request; Instagram matches data.js', () => {
  assert.equal(env.SHOP_INSTAGRAM, COPY.instagram);
  const print = fnSrc('printOrder');
  assert.match(print, /ORDERS_CACHE\.find/);
  assert.match(print, /ORDER_ITEMS_BY_ORDER\[o\.id\]/);
  assert.match(print, /window\.open\('', '_blank'\)/);
  assert.match(print, /orderPrintHtml\(o, ORDER_ITEMS_BY_ORDER\[o\.id\] \|\| \[\], location\.origin\)/);
  assert.match(print, /win\.print\(\)/);
  for (const src of [print, fnSrc('orderPrintHtml')]) assert.doesNotMatch(src, /\bfetch\(|\bsb\.|XMLHttpRequest/);
});
