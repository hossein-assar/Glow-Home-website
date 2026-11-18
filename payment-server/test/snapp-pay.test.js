// Checkout's Snapp Pay banner: the logos (plain images), a line and a
// بیشتر/بستن toggle; open, a message asking the customer to write to Sahar
// and the checkout's WhatsApp (cart + instalment line), Telegram and
// Instagram buttons. No link to Snapp Pay's website anywhere in the repo,
// no old 7-step list, no order, no request, no number on show, no tel:.
// Runs the real code from app.js. The Snapp Pay domain and the old button
// label are built from pieces here so this file doesn't match itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const appJs = read('app.js');
const dataJs = read('data.js');
const cssText = read('styles.css');
const grab = (src, re) => {
  const m = src.match(re);
  assert.ok(m, 'not found: ' + re);
  return m[0];
};
const fnSrc = (name) => grab(appJs, new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
const { COPY, ONLINE_PAYMENT } = new Function(dataJs + '\nreturn { COPY, ONLINE_PAYMENT };')();

const MSG = 'برای خرید اقساطی با اسنپ‌پی، از طریق تلگرام، واتساپ یا اینستاگرام به سحر پیام بدهید تا خرید شما را با هم نهایی کنیم.';
const WA_LINE = 'می‌خواهم به صورت اقساطی با اسنپ‌پی پرداخت کنم.';

const CART_ROWS = [
  { cartKey: 'gisoo::h120::sembroidered', fa: 'گیسو', heightFa: '۱۲۰ سانتی‌متر', shadeFa: 'شید گلدوزی', qty: 1 },
  { cartKey: 'lale::c1', fa: 'لاله', heightFa: '۴۰ سانتی‌متر', color: 'سبز', qty: 2 },
];

/** The real banner, button and message code from app.js with a stub cart. */
function bannerEnv({ open = true, pay = 'gateway', copy = {}, city = '' } = {}) {
  const state = { snappPayOpen: open, pay, form: { name: 'سارا', phone: '9121234567', city, address: 'خیابان ولیعصر', postcode: '', note: '' } };
  const calls = [];
  const env = new Function(
    'state', 'COPY', 'ONLINE_PAYMENT', 'totals', 'fetch', 'render', 'document',
    `const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
     const icon = (n) => '<svg data-icon="' + n + '"></svg>';
     ${grab(appJs, /const FA_DIGITS = [^\n]*\n/)}
     ${grab(appJs, /const AR_DIGITS = [^\n]*\n/)}
     ${grab(appJs, /const FA = [^\n]*\n/)}
     ${grab(appJs, /const money = [^\n]*\n/)}
     ${grab(appJs, /const SNAPP_PAY_WA_LINE = [^\n]*\n/)}
     ${grab(appJs, /const SNAPP_PAY_MSG =\s*\n[^\n]*\n/)}
     ${fnSrc('toLatinDigits')}
     ${fnSrc('parseCartKey')}
     ${fnSrc('phoneIntl')}
     ${fnSrc('contactPhoneIntl')}
     ${fnSrc('contactWhatsappIntl')}
     ${fnSrc('contactMessage')}
     ${fnSrc('whatsAppHref')}
     ${fnSrc('whatsappIcon')}
     ${fnSrc('telegramHref')}
     ${fnSrc('telegramIcon')}
     ${fnSrc('contactLinksHtml')}
     ${fnSrc('snappPayBannerHtml')}
     ${fnSrc('refreshWhatsAppLink')}
     return { snappPayBannerHtml, whatsAppHref, contactMessage, contactWhatsappIntl, refreshWhatsAppLink };`
  )(
    state,
    { ...COPY, ...copy },
    ONLINE_PAYMENT,
    () => ({ rows: CART_ROWS, total: 3000000 + (state.form.city && state.form.city !== 'تهران' ? 250000 : 0) }),
    () => { calls.push('fetch'); },
    () => { calls.push('render'); },
    { addEventListener() {} }
  );
  return { ...env, state, calls };
}

const body = (html) => grab(html, /<div class="snapp-pay-body"[\s\S]*$/);
const buttons = (html) =>
  [...html.matchAll(/<(a|button) class="btn ([a-z-]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => [m[3].replace(/<svg[\s\S]*?<\/svg>/g, '').trim(), m[2]]);
const textOf = (href) => new URL(href.replace(/&amp;/g, '&')).searchParams.get('text') ?? '';

// ---- nothing points to Snapp Pay -----------------------------------------------

const SKIP_DIRS = new Set(['.git', 'node_modules', '.vercel']);
const BINARY = /\.(jpe?g|png|gif|webp|ico|woff2?|ttf|otf|pdf|zip)$/i;
function* textFiles(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) yield* textFiles(join(dir, ent.name));
    } else if (!BINARY.test(ent.name)) {
      yield join(dir, ent.name);
    }
  }
}
const SNAPP = 'snapp';
// The Snapp Pay domains (with or without a dash, any common TLD), Snapp's
// own domains, and any URL that mentions the brand.
const SNAPP_URL_RES = [
  new RegExp(SNAPP + '-?pay\\.(site|ir|com|co|io|net)', 'i'),
  new RegExp('\\bsnap' + 'ppay\\b', 'i'),
  new RegExp('snapp\\.(ir|site|com|taxi|market)', 'i'),
  new RegExp('(https?:)?//[^\\s\'"`)]*' + SNAPP, 'i'),
];
const OLD_LABEL = 'خرید ' + 'اقساط';
const OLD_LABEL_RE = new RegExp(OLD_LABEL + '(?!ی)'); // «خرید اقساطی» in the message is fine

test('the scan patterns catch the old link and the old button label', () => {
  const oldLink = 'https://social.' + SNAPP + 'pay.site/0r3z3';
  assert.ok(SNAPP_URL_RES.some((re) => re.test(oldLink)));
  for (const u of ['https://' + SNAPP + 'pay.ir/x', 'http://' + SNAPP + '-pay.ir', 'https://app.' + SNAPP + '.ir/pay']) assert.ok(SNAPP_URL_RES.some((re) => re.test(u)), u);
  for (const ok of ['images/snapp-pay-logo.png', '.snapp-pay-banner', 'state.snappPayOpen']) assert.ok(!SNAPP_URL_RES.some((re) => re.test(ok)), ok);
  assert.match(`<a class="btn">${OLD_LABEL}</a>`, OLD_LABEL_RE);
  assert.doesNotMatch(MSG, OLD_LABEL_RE);
});

test('no Snapp Pay URL and no «' + OLD_LABEL + '» button anywhere in the repo (code, styles, tests, docs)', () => {
  const hits = [];
  let scanned = 0;
  for (const file of textFiles(ROOT)) {
    scanned++;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (SNAPP_URL_RES.some((re) => re.test(line)) || OLD_LABEL_RE.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.ok(scanned > 50, 'scanned ' + scanned);
  assert.deepEqual(hits, []);
});

test('the old 7-step list, its heading and its styles are gone', () => {
  for (const gone of ['SNAPP_PAY_STEPS', 'snapp-pay-step', 'snapp-pay-steps', 'snapp-pay-cta', 'گام‌های خرید از طریق اسنپ‌پی', 'وی‌پی‌ان', 'لینک پرداخت', 'کد رهگیری رو']) {
    assert.ok(!appJs.includes(gone), 'app.js: ' + gone);
    assert.ok(!cssText.includes(gone), 'styles.css: ' + gone);
    assert.ok(!dataJs.includes(gone), 'data.js: ' + gone);
  }
});

// ---- the banner ---------------------------------------------------------------

test('checkout renders the banner; the toggle only flips state.snappPayOpen and re-renders', () => {
  assert.match(fnSrc('screenCheckout'), /\$\{snappPayBannerHtml\(\)\}/);
  const action = grab(appJs, /'snapp-pay-toggle': \(\) => \{[\s\S]*?\n {2}\},/);
  assert.equal(action.replace(/\s+/g, ' '), "'snapp-pay-toggle': () => { state.snappPayOpen = !state.snappPayOpen; render(); },");
});

test('closed: logos as plain images, the line and «بیشتر»; the body is hidden by CSS', () => {
  const html = bannerEnv({ open: false }).snappPayBannerHtml();
  assert.match(html, /^<div class="alert alert-whatsapp snapp-pay-banner " /);
  assert.match(html, /<img class="snapp-pay-logo" src="images\/snapp-pay-logo\.png" alt="Snapp Pay"/);
  assert.match(html, /<img class="snapp-pay-logo snapp-pay-logo-fa" src="images\/snapp-pay-logo-fa\.png" alt="اسنپ‌پی"/);
  const header = grab(html, /<div class="snapp-pay-logo-header">[\s\S]*?<\/div>/);
  assert.doesNotMatch(header, /<a\b/, 'no link around the logos');
  assert.match(html, /<span>برای خرید اقساطی با اسنپ‌پی در ۴ قسط گزینه بیشتر کلیک کن<\/span>/);
  assert.match(html, /data-act="snapp-pay-toggle"\s+aria-expanded="false"\s+aria-controls="snapp-pay-body"\s*>بیشتر<\/button>/);
  assert.match(cssText, /\.snapp-pay-body \{ display: none;/);
  assert.match(cssText, /\.snapp-pay-banner\.open \.snapp-pay-body \{ display: block; \}/);
});

test('open: «بستن», only the message and WhatsApp (main) → Telegram → Instagram', () => {
  const e = bannerEnv();
  const html = e.snappPayBannerHtml();
  assert.match(html, /^<div class="alert alert-whatsapp snapp-pay-banner open" /);
  assert.match(html, /aria-expanded="true"\s+aria-controls="snapp-pay-body"\s*>بستن<\/button>/);
  const b = body(html);
  assert.equal(b.match(/<p>([\s\S]*?)<\/p>/)[1], MSG);
  assert.equal([...b.matchAll(/<p>/g)].length, 1, 'one message only');
  assert.doesNotMatch(b, /<h[1-6]|<ol|<ul|<li/);
  assert.deepEqual(buttons(b), [
    ['ارسال پیام در واتساپ', 'btn-accent'],
    ['پیام در تلگرام', 'btn-ghost'],
    ['پیام در اینستاگرام', 'btn-ghost'],
  ]);
  assert.match(b, /<div class="pay-contact-links">/, 'same look as the checkout box');
  assert.ok(b.includes(`href="${COPY.telegramUrl}" target="_blank" rel="noopener noreferrer"`));
  assert.ok(b.includes(`href="${COPY.instagramUrl}" target="_blank" rel="noopener"`));
  assert.deepEqual(e.calls, [], 'no request, no render');
});

test('the WhatsApp link: data.js number, the cart, the total and the instalment line', () => {
  const e = bannerEnv({ city: 'کرج', pay: 'card' });
  const b = body(e.snappPayBannerHtml());
  const href = b.match(/<a class="btn btn-accent" data-wa="snapp" href="([^"]*)"/)[1];
  assert.ok(href.startsWith('https://wa.me/' + e.contactWhatsappIntl() + '?text='));
  assert.equal(textOf(href), [
    'سلام، می‌خواهم این سفارش را ثبت کنم.',
    WA_LINE,
    '• گیسو (۱۲۰ سانتی‌متر · شید گلدوزی) × ۱',
    '• لاله (سبز) × ۲',
    'جمع: ۳٬۲۵۰٬۰۰۰ تومان',
    'شهر: کرج',
  ].join('\n'));
  // the card-to-card box's own message is unchanged
  assert.doesNotMatch(e.contactMessage(), new RegExp(WA_LINE));
  assert.match(e.contactMessage(), /^سلام، می‌خواهم سفارشم را با کارت به کارت پرداخت کنم\./);
});

test('clicking the banner WhatsApp link refreshes it and keeps the instalment line; the box link keeps its own', () => {
  const e = bannerEnv();
  const attr = (v) => ({ getAttribute: (n) => (n === 'data-wa' ? v : null) });
  const snappLink = { href: '', ...attr('snapp') };
  const boxLink = { href: '', ...attr('') };
  e.state.form.city = 'اصفهان';
  e.refreshWhatsAppLink({ target: { closest: () => snappLink } });
  e.refreshWhatsAppLink({ target: { closest: () => boxLink } });
  assert.match(textOf(snappLink.href), new RegExp(WA_LINE + '[\\s\\S]*شهر: اصفهان$'));
  assert.match(textOf(boxLink.href), /شهر: اصفهان$/);
  assert.doesNotMatch(textOf(boxLink.href), new RegExp(WA_LINE));
  assert.deepEqual(e.calls, []);
});

test('each button hides when its data.js value is empty; the next one becomes the main one', () => {
  const noWa = buttons(body(bannerEnv({ copy: { contactWhatsapp: '', contactPhone: '' } }).snappPayBannerHtml()));
  assert.deepEqual(noWa, [['پیام در تلگرام', 'btn-accent'], ['پیام در اینستاگرام', 'btn-ghost']]);
  const noTg = buttons(body(bannerEnv({ copy: { telegram: '', telegramUrl: '' } }).snappPayBannerHtml()));
  assert.deepEqual(noTg, [['ارسال پیام در واتساپ', 'btn-accent'], ['پیام در اینستاگرام', 'btn-ghost']]);
  const noIg = buttons(body(bannerEnv({ copy: { instagramUrl: '' } }).snappPayBannerHtml()));
  assert.deepEqual(noIg, [['ارسال پیام در واتساپ', 'btn-accent'], ['پیام در تلگرام', 'btn-ghost']]);
  const onlyIg = bannerEnv({ copy: { contactWhatsapp: '', contactPhone: '', telegram: '', telegramUrl: '' } }).snappPayBannerHtml();
  assert.deepEqual(buttons(body(onlyIg)), [['پیام در اینستاگرام', 'btn-accent']]);
  assert.ok(!onlyIg.includes('wa.me') && !onlyIg.includes('t.me'));
  const none = body(bannerEnv({ copy: { contactWhatsapp: '', contactPhone: '', telegram: '', telegramUrl: '', instagramUrl: '' } }).snappPayBannerHtml());
  assert.deepEqual(buttons(none), []);
  assert.equal(none.match(/<p>([\s\S]*?)<\/p>/)[1], MSG);
});

test('no number on show, no tel:, no «تماس بگیرید», no order, even with a call number set', () => {
  for (const copy of [{}, { contactPhone: '۰۹۱۲ ۳۴۵ ۶۷۸۹' }]) {
    const html = bannerEnv({ copy }).snappPayBannerHtml();
    assert.ok(!html.includes('tel:'));
    assert.doesNotMatch(html, /تماس بگیر|زنگ بزن/);
    assert.doesNotMatch(html.replace(/href="[^"]*"/g, ''), /[0-9۰-۹٠-٩]{4}/, 'no number on show');
    assert.doesNotMatch(html, /data-act="place-order"|data-nav/);
  }
  assert.doesNotMatch(fnSrc('snappPayBannerHtml'), /fetch|placeOrder|render\(/);
});
