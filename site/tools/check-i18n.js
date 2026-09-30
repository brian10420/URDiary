#!/usr/bin/env node
/**
 * Checks the showcase copy in site/i18n.js. Exit code 1 on any failure.
 *   1. zh-TW and en have exactly the same keys (every missing key is listed);
 *   2. no empty strings, and {placeholders} match between the two locales;
 *   3. every key the page uses exists: data-i18n / data-i18n-html / data-i18n-attr in
 *      index.html, key-shaped string literals in app.js, and the stamp.<id> family built
 *      from app.js's STAMPS list;
 *   4. the static <title>, meta description and og:title / og:description (what crawlers and
 *      link previews read, since they don't run JS) equal the en strings — no drift;
 *   5. data-i18n-html strings only use harmless inline markup.
 * Keys defined but never used are reported as warnings.
 *
 *   node site/tools/check-i18n.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(SITE, name), 'utf8');

const sandbox = { window: {} };
vm.runInNewContext(read('i18n.js'), sandbox, { filename: 'i18n.js' });
const dict = sandbox.window.SITE_I18N;
const errors = [];
const warnings = [];

if (!dict || typeof dict !== 'object') {
    console.error('check-i18n: window.SITE_I18N not found in site/i18n.js');
    process.exit(1);
}
const LOCALES = ['zh-TW', 'en'];
for (const loc of LOCALES) {
    if (!dict[loc]) errors.push(`locale "${loc}" is missing`);
}
if (errors.length) { errors.forEach((e) => console.error('✗ ' + e)); process.exit(1); }
const extra = Object.keys(dict).filter((k) => !LOCALES.includes(k));
if (extra.length) errors.push(`unexpected locale(s): ${extra.join(', ')}`);

// 1 + 2: parity, empties, placeholders
const keys = {};
for (const loc of LOCALES) keys[loc] = new Set(Object.keys(dict[loc]));
for (const [a, b] of [['zh-TW', 'en'], ['en', 'zh-TW']]) {
    for (const k of keys[a]) if (!keys[b].has(k)) errors.push(`key "${k}" exists in ${a} but is missing in ${b}`);
}
const holders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
for (const loc of LOCALES) {
    for (const [k, v] of Object.entries(dict[loc])) {
        if (typeof v !== 'string' || v.trim() === '') errors.push(`${loc} "${k}" is empty or not a string`);
    }
}
for (const k of keys.en) {
    if (keys['zh-TW'].has(k) && holders(dict.en[k]) !== holders(dict['zh-TW'][k])) {
        errors.push(`placeholders differ for "${k}": zh-TW {${holders(dict['zh-TW'][k])}} vs en {${holders(dict.en[k])}}`);
    }
}

// 3: every referenced key exists
const html = read('index.html');
const app = read('app.js');
const used = new Map();   // key -> where
const use = (k, where) => { if (!used.has(k)) used.set(k, where); };
for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) use(m[1], 'index.html');
for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(';')) {
        const i = pair.indexOf(':');
        if (i > 0) use(pair.slice(i + 1).trim(), 'index.html (attr)');
        else errors.push(`malformed data-i18n-attr pair "${pair}" in index.html`);
    }
}
for (const m of app.matchAll(/'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)'/g)) use(m[1], 'app.js');
const stampList = app.match(/var STAMPS = \[([^\]]+)\]/);
if (!stampList) errors.push('could not find the STAMPS list in app.js');
else for (const m of stampList[1].matchAll(/'([a-z]+)'/g)) use(`stamp.${m[1]}`, 'app.js (STAMPS)');
for (const [k, where] of used) {
    for (const loc of LOCALES) if (!keys[loc].has(k)) errors.push(`key "${k}" used in ${where} is missing in ${loc}`);
}
for (const k of keys.en) if (!used.has(k)) warnings.push(`key "${k}" is defined but never used`);

// 4: static metadata equals the en strings
const attr = (re) => { const m = html.match(re); return m ? m[1] : null; };
const staticMeta = {
    '<title>': [attr(/<title>([^<]*)<\/title>/), 'meta.title'],
    'meta description': [attr(/<meta name="description" content="([^"]*)"/), 'meta.description'],
    'og:title': [attr(/<meta property="og:title" content="([^"]*)"/), 'meta.title'],
    'og:description': [attr(/<meta property="og:description" content="([^"]*)"/), 'meta.description'],
};
for (const [label, [value, key]] of Object.entries(staticMeta)) {
    if (value === null) errors.push(`index.html has no ${label}`);
    else if (value !== dict.en[key]) errors.push(`index.html ${label} differs from en "${key}"`);
}

// 5: inline markup only
for (const m of html.matchAll(/data-i18n-html="([^"]+)"/g)) {
    for (const loc of LOCALES) {
        const tags = (String(dict[loc][m[1]] || '').match(/<\/?([a-z0-9]+)/gi) || []).map((s) => s.replace(/[</]/g, '').toLowerCase());
        const bad = tags.filter((tag) => !['mark', 'strong', 'em', 'a', 'br', 'code'].includes(tag));
        if (bad.length) errors.push(`${loc} "${m[1]}" uses disallowed markup: ${bad.join(', ')}`);
    }
}

warnings.forEach((w) => console.warn('! ' + w));
if (errors.length) {
    errors.forEach((e) => console.error('✗ ' + e));
    console.error(`check-i18n: FAILED (${errors.length} problem${errors.length > 1 ? 's' : ''})`);
    process.exit(1);
}
console.log(`check-i18n: OK — ${keys.en.size} keys in both zh-TW and en, ${used.size} referenced, ${warnings.length} warning(s)`);
