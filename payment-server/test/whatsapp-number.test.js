// The shop's WhatsApp number (messages only) is written in one place for
// the site, COPY.contactWhatsapp in data.js; app.js builds the wa.me links
// from it. The one other copy allowed is admin/admin.js's SHOP_SENDER_PHONE
// (the sender on the printed parcel label — admin.js can't load data.js;
// admin-orders.test.js keeps the two equal). Fails if it is copied anywhere
// else in the repo — in any digit form, with or without the 0 / +98 — so it
// can't end up as visible digits or in a tel: link on the site by hand. The
// number is read from data.js, never written here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dataJs = readFileSync(join(ROOT, 'data.js'), 'utf8');
const { COPY } = new Function(dataJs + '\nreturn { COPY };')();
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

const latin = (s) => s.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660);
// The national part (after 0 / 98), each digit in any form, any separators.
const core = latin(String(COPY.contactWhatsapp)).replace(/\D/g, '').replace(/^(98|0)/, '');
const d = (c) => `[${c}${String.fromCharCode(0x6f0 + +c)}${String.fromCharCode(0x660 + +c)}]`;
const NUMBER_RE = new RegExp([...core].map(d).join('[\\s\\-.()\\u200c\\u200e\\u200f\\u00a0/]*'));

test('COPY.contactWhatsapp is an Iranian mobile; COPY.contactPhone stays empty', () => {
  assert.match(core, /^9[0-9]{9}$/);
  assert.equal(COPY.contactPhone, '');
});

test('the WhatsApp number is written only in data.js (contactWhatsapp) and admin.js (SHOP_SENDER_PHONE), in any digit form', () => {
  const hits = [];
  for (const file of textFiles(ROOT)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (NUMBER_RE.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  hits.sort();
  assert.equal(hits.length, 2, hits.join('\n'));
  assert.match(hits[0], /^admin\/admin\.js:\d+: const SHOP_SENDER_PHONE = '[^']*';$/);
  assert.match(hits[1], /^data\.js:\d+: contactWhatsapp: '[^']*',$/);
});
