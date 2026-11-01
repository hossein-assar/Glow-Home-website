// The shop's old number was taken off the site (too many calls). Fails if it
// comes back anywhere in the repo — every file Vercel serves (app.js,
// data.js, index.html, admin/, api/, the docs) and the rest — in Latin,
// Persian or Arabic digits, with or without spaces, dashes, dots, the
// leading 0 or a +98 / 0098 prefix, and inside tel: or wa.me links. The
// number is never written out here, so this file doesn't match itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OLD = [9, 1, 9, 5, 8, 1, 9, 2, 0, 3]; // without the leading 0
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

// Each digit in any of its three forms, any separators between digits.
const digit = (d) => `[${d}${String.fromCharCode(0x6f0 + d)}${String.fromCharCode(0x660 + d)}]`;
const SEP = '[\\s\\-.()\\u200c\\u200e\\u200f\\u00a0/]*';
const OLD_RE = new RegExp(OLD.map(digit).join(SEP));

test('the pattern catches the old number in every form it could be written', () => {
  const fa = (s) => s.replace(/[0-9]/g, (d) => String.fromCharCode(0x6f0 + +d));
  const ar = (s) => s.replace(/[0-9]/g, (d) => String.fromCharCode(0x660 + +d));
  const n = '0' + OLD.join('');
  const groups = `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  for (const form of [n, fa(n), ar(n), groups, fa(groups), groups.replace(/ /g, '-'), groups.replace(/ /g, '.'),
    '+98' + n.slice(1), '+98 ' + groups.slice(1), '0098' + n.slice(1), 'tel:+98' + n.slice(1), 'https://wa.me/98' + n.slice(1) + '?text=x',
    fa(n.slice(0, 5)) + n.slice(5)]) {
    assert.match(form, OLD_RE, form);
  }
  for (const other of ['09121234567', '09195819204', '0919581920', '۰۹۱۲۱۲۳۴۵۶۷']) assert.doesNotMatch(other, OLD_RE, other);
  // the shop's current WhatsApp number (data.js) doesn't trip it
  const { COPY } = new Function(readFileSync(join(ROOT, 'data.js'), 'utf8') + '\nreturn { COPY };')();
  assert.ok(COPY.contactWhatsapp);
  assert.doesNotMatch(COPY.contactWhatsapp, OLD_RE);
});

test('the old number appears in no file of the repo, in any digit form', () => {
  const hits = [];
  let scanned = 0;
  for (const file of textFiles(ROOT)) {
    scanned++;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (OLD_RE.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}`);
    });
  }
  assert.ok(scanned > 50, 'scanned ' + scanned + ' files');
  assert.deepEqual(hits, []);
});
