#!/usr/bin/env node
/**
 * End-to-end checks for the showcase page in real browsers (Playwright from desktop/node_modules).
 * Serves site/ with `python3 -m http.server` on a free port ≥ 8130 and stops it afterwards.
 *
 *   site/tools/sync-mascot.sh && node site/tools/verify-site.js [--out <screenshot dir>] [--skip-media]
 *
 * Checks (every one prints PASS/FAIL; exit code 1 if any fails):
 *   - preflight: tools/check-i18n.js, sync-mascot.sh --check, media-manifest.js --check
 *   - 1440×900 and 390×844 × zh-TW/en × light/dark: zero console errors/warnings, page errors,
 *     failed requests or HTTP errors; every reveal ran; every screenshot image loaded;
 *     viewport + full-page screenshots saved to --out
 *   - prefers-reduced-motion: document.getAnimations().length === 0 after load (and after a tap
 *     and a celebration), no hidden reveals, the tap hint is not offered
 *   - no horizontal overflow at 360 and 390 px (both languages, after scrolling everything in)
 *   - every same-origin URL the page references answers 200 (both screenshot languages too);
 *     every #anchor target exists
 *   - a11y basics: one <h1>, banner/navigation/main/contentinfo landmarks, heading levels never
 *     skip, every <img> has alt (screenshots non-empty), every <svg> is aria-hidden or labelled,
 *     every button has a name, the language toggle is a <button>
 *   - text contrast ≥ 4.5:1 (3:1 for large text) in light and dark
 *   - no layout shift while loading and scrolling (CLS), page weight without videos ≤ 3 MB
 *   - language: navigator.language zh* → zh-TW else en; the toggle switches <html lang>, title and
 *     screenshots; the choice survives a reload
 *   - interactions: eye-follow, tap reaction (pointer + keyboard), both celebrations play inside
 *     their card one at a time and clean up, lightbox opens/closes, copy button copies
 *   - media: with a throwaway H.264 clip listed in a temporary copy of the site, Google Chrome
 *     switches the hero to the video and shows the intro in the matching language; a corrupt
 *     listed file falls back through onerror to the mascot / "coming soon" card
 */
'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SITE = path.resolve(__dirname, '..');
const REPO = path.resolve(SITE, '..');
const { chromium } = require(path.join(REPO, 'desktop', 'node_modules', 'playwright'));
const FFMPEG = process.env.STATIC_FFMPEG || '/mnt/Data_SSD/ComfyUI/.venv/bin/static_ffmpeg';

const args = process.argv.slice(2);
const argOut = args.indexOf('--out');
const OUT = argOut >= 0 && args[argOut + 1] ? path.resolve(args[argOut + 1]) : path.join(os.tmpdir(), 'urdiary-site-shots');
const SKIP_MEDIA = args.includes('--skip-media');
const MAX_WEIGHT = 3 * 1024 * 1024;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ------------------------------------------------------------------ server helpers
function freePort(start) {
    return new Promise((resolve, reject) => {
        const tryPort = (p) => {
            if (p > start + 80) { reject(new Error('no free port')); return; }
            const srv = net.createServer();
            srv.once('error', () => tryPort(p + 1));
            srv.once('listening', () => srv.close(() => resolve(p)));
            srv.listen(p, '127.0.0.1');
        };
        tryPort(start);
    });
}
function request(url, method = 'GET') {
    return new Promise((resolve) => {
        const req = http.request(url, { method }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', () => resolve(0));
        req.end();
    });
}
async function serve(dir) {
    const port = await freePort(8130);
    const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], { stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 60; i++) {
        if (await request(base) === 200) return { base, port, proc };
        await new Promise((r) => setTimeout(r, 100));
    }
    proc.kill();
    throw new Error(`server on ${port} did not start`);
}
async function stop(server) {
    if (!server) return;
    server.proc.kill();
    for (let i = 0; i < 40; i++) {
        if (await request(server.base) === 0) return true;
        await new Promise((r) => setTimeout(r, 100));
    }
    return false;
}

// ------------------------------------------------------------------ page helpers
async function newPage(browser, opts) {
    const context = await browser.newContext({
        viewport: { width: opts.width, height: opts.height },
        deviceScaleFactor: opts.dpr || 1,
        colorScheme: opts.scheme || 'light',
        reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
        locale: opts.locale || (opts.lang === 'en' ? 'en-US' : 'zh-TW'),
        hasTouch: !!opts.touch,
        isMobile: !!opts.mobile,
    });
    if (opts.lang) {
        await context.addInitScript((l) => { try { localStorage.setItem('urdiary-site-lang', l); } catch (e) { /* */ } }, opts.lang);
    }
    await context.addInitScript(() => {
        window.__cls = 0;
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
            }).observe({ type: 'layout-shift', buffered: true });
        } catch (e) { /* not supported */ }
    });
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => {
        const why = r.failure() ? r.failure().errorText : '';
        if (r.resourceType() === 'media' && /ERR_ABORTED/.test(why)) return;   // Chrome cancels media range requests by design
        problems.push(`requestfailed: ${r.url()} ${why}`);
    });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
    return { context, page, problems };
}
async function open(page, url) {
    await page.goto(url);
    await page.waitForSelector('html.is-ready', { state: 'attached', timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
}
async function scrollThrough(page) {
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    const vh = page.viewportSize().height;
    let h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= h; y += Math.round(vh * 0.5)) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(110);
        h = await page.evaluate(() => document.documentElement.scrollHeight);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1000);                           // last reveals finish (.75s + delay)
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 20000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
}
const name = (o) => `${o.width >= 1000 ? 'desktop' : 'mobile'}-${o.width}-${o.lang === 'en' ? 'en' : 'zh'}-${o.scheme}${o.reduced ? '-reduced' : ''}`;

// Contrast of every visible text run (WCAG 2 relative luminance), outside SVG graphics.
function contrastAudit() {
    const OVERLAYS = [['.tap-hint', '.stage']];   // absolutely placed over a sibling, not an ancestor
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c || '');
        if (!m) return null;
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    function background(el) {
        const layers = [];
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const swap = OVERLAYS.find(([sel]) => n.matches(sel));
            if (swap) { const host = n.parentElement && n.parentElement.querySelector(swap[1]); if (host) { n = host; } }
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
        }
        let base = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
        return base;
    }
    const seen = new Set();
    const failures = [];
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!t.nodeValue.trim()) continue;
        const el = t.parentElement;
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (el.closest('svg, noscript, script, style, .visually-hidden, dialog:not([open])')) continue;
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (cs.visibility !== 'visible' || rect.width === 0 || rect.height === 0) continue;
        let opacity = 1;
        for (let n = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
        if (opacity < 0.99) continue;                    // mid-transition or intentionally faded
        const fg = parse(cs.color);
        if (!fg) continue;
        const bg = background(el);
        const f = over(fg, bg);
        const L1 = lum(f), L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        const need = large ? 3 : 4.5;
        checked++;
        if (ratio < need) failures.push(`${ratio.toFixed(2)} < ${need}: "${t.nodeValue.trim().slice(0, 40)}" (${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]})`);
    }
    return { checked, failures };
}

// ------------------------------------------------------------------ checks
async function matrix(browser, base) {
    const combos = [];
    for (const [width, height] of [[1440, 900], [390, 844]]) {
        for (const lang of ['zh-TW', 'en']) {
            for (const scheme of ['light', 'dark']) combos.push({ width, height, lang, scheme, mobile: width < 600, touch: width < 600 });
        }
    }
    combos.push({ width: 1440, height: 900, lang: 'zh-TW', scheme: 'light', reduced: true });
    combos.push({ width: 390, height: 844, lang: 'en', scheme: 'dark', reduced: true, mobile: true, touch: true });

    for (const o of combos) {
        const n = name(o);
        const { context, page, problems } = await newPage(browser, o);
        await open(page, base);
        await page.screenshot({ path: path.join(OUT, `${n}-top.png`) });
        if (o.reduced) {
            await page.waitForTimeout(1000);
            const anim = await page.evaluate(() => document.getAnimations().length);
            check(`${n}: no running animations after load (reduced motion)`, anim === 0, `document.getAnimations().length = ${anim}`);
        }
        await scrollThrough(page);
        const reveal = await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('.reveal'));
            const hidden = all.filter((el) => Number(getComputedStyle(el).opacity) < 0.99);
            return { total: all.length, hidden: hidden.length, motionOk: document.documentElement.classList.contains('motion-ok') };
        });
        check(`${n}: every reveal visible after scrolling`, reveal.hidden === 0, `${reveal.total - reveal.hidden}/${reveal.total} visible, reveal animations ${reveal.motionOk ? 'on' : 'off'}`);
        const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('img[data-shot]')).map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth })));
        const dir = o.lang === 'en' ? '/en/' : '/zh/';
        check(`${n}: all ${imgs.length} screenshots loaded in the page language`, imgs.every((i) => i.w > 1 && i.src.includes(dir)), imgs.filter((i) => i.w <= 1 || !i.src.includes(dir)).map((i) => i.src).join(', '));
        const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        check(`${n}: no horizontal overflow`, overflow.sw <= o.width && overflow.iw === o.width, `scrollWidth ${overflow.sw}, innerWidth ${overflow.iw}, device ${o.width}`);
        if (o.reduced) {
            const after = await page.evaluate(() => ({ anim: document.getAnimations().length, hint: !!document.querySelector('#tap-hint:not([hidden])') }));
            check(`${n}: still no animations after scrolling, no "tap me" offered`, after.anim === 0 && !after.hint, `animations ${after.anim}, hint shown ${after.hint}`);
            await page.click('#hero-mascot');
            await page.click('.btn-egg[data-egg="happy"]');
            await page.waitForTimeout(250);
            const act = await page.evaluate(() => ({
                anim: document.getAnimations().length,
                reacted: !!document.querySelector('#hero-mascot svg.mm-react'),
                eggInCard: !!document.querySelector('#pg-egg-happy > .mascot-egg'),
            }));
            check(`${n}: tap does nothing, celebration shows as a still, zero animations`, act.anim === 0 && !act.reacted && act.eggInCard, JSON.stringify(act));
            await page.waitForTimeout(2000);
        }
        const cls = await page.evaluate(() => window.__cls);
        check(`${n}: no layout shift (CLS)`, cls < 0.02, `CLS ${cls.toFixed(4)}`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(OUT, `${n}-full.png`), fullPage: true });
        check(`${n}: zero console errors/warnings, page errors, failed requests`, problems.length === 0, problems.slice(0, 5).join(' | ') || 'clean');
        await context.close();
    }
}

async function overflowNarrow(browser, base) {
    for (const width of [360, 390]) {
        for (const [lang, scheme] of [['zh-TW', 'light'], ['en', 'light'], ['zh-TW', 'dark'], ['en', 'dark']]) {
            const o = { width, height: 800, lang, scheme, mobile: true, touch: true };
            const { context, page, problems } = await newPage(browser, o);
            await open(page, base);
            await scrollThrough(page);
            const r = await page.evaluate(() => {
                const iw = window.innerWidth;
                const wide = Array.from(document.querySelectorAll('body *')).filter((el) => {
                    const b = el.getBoundingClientRect();
                    return b.width > 1 && (b.right > iw + 0.5 || b.left < -0.5) && !el.closest('.code, .lightbox, .visually-hidden');
                }).slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
                return { sw: document.documentElement.scrollWidth, iw, wide };
            });
            check(`${width}px ${lang} ${scheme}: no horizontal scroll`, r.sw <= width && r.iw === width && r.wide.length === 0 && problems.length === 0, `scrollWidth ${r.sw}, innerWidth ${r.iw}${r.wide.length ? `; poking out: ${r.wide.join(', ')}` : ''}${problems.length ? `; ${problems[0]}` : ''}`);
            if (width === 360) await page.screenshot({ path: path.join(OUT, `mobile-360-${lang === 'en' ? 'en' : 'zh'}-${scheme}-top.png`) });
            await context.close();
        }
    }
}

async function linksAndA11y(browser, base) {
    const { context, page, problems } = await newPage(browser, { width: 1440, height: 900, lang: 'en', scheme: 'light' });
    await open(page, base);
    await scrollThrough(page);
    const refs = await page.evaluate(() => {
        const out = [];
        const add = (kind, v) => { if (v) out.push([kind, v]); };
        document.querySelectorAll('a[href]').forEach((a) => add('a', a.getAttribute('href')));
        document.querySelectorAll('link[href]').forEach((l) => add('link', l.getAttribute('href')));
        document.querySelectorAll('script[src]').forEach((s) => add('script', s.getAttribute('src')));
        document.querySelectorAll('img[src]').forEach((i) => add('img', i.getAttribute('src')));
        document.querySelectorAll('video').forEach((v) => { add('video', v.getAttribute('src')); });
        document.querySelectorAll('img[data-shot]').forEach((i) => {
            add('shot', `assets/screens/zh/${i.getAttribute('data-shot')}.webp`);
            add('shot', `assets/screens/en/${i.getAttribute('data-shot')}.webp`);
        });
        return out;
    });
    const internal = [];
    const external = new Set();
    const anchors = [];
    for (const [kind, ref] of refs) {
        if (ref.startsWith('data:')) continue;
        if (ref.startsWith('#')) { anchors.push(ref); continue; }
        const url = new URL(ref, base);
        if (url.origin !== new URL(base).origin) { external.add(url.href); continue; }
        internal.push([kind, url.href]);
    }
    internal.push(['manifest', new URL('media/manifest.json', base).href], ['og', new URL('assets/og-image.png', base).href]);
    const unique = Array.from(new Map(internal.map(([k, u]) => [u, k])).keys());
    const bad = [];
    for (const u of unique) { const s = await request(u, 'GET'); if (s !== 200) bad.push(`${s} ${u}`); }
    check(`internal links: ${unique.length} same-origin URLs answer 200`, bad.length === 0, bad.join(', ') || `${external.size} external (github.com) not fetched`);
    const missingAnchors = await page.evaluate((list) => list.filter((h) => !document.getElementById(h.slice(1))), Array.from(new Set(anchors)));
    check(`in-page anchors: ${new Set(anchors).size} targets exist`, missingAnchors.length === 0, missingAnchors.join(', '));
    const relative = await request(new URL('index.html', base).href);
    const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
    const rootAbs = html.match(/(?:src|href)="\/[^/]/g) || [];
    check('no root-absolute URLs (the site lives under /URDiary/)', rootAbs.length === 0 && relative === 200, rootAbs.join(', '));

    const a11y = await page.evaluate(() => {
        const r = {};
        r.h1 = document.querySelectorAll('h1').length;
        const levels = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => Number(h.tagName[1]));
        r.skips = levels.filter((lv, i) => i > 0 && lv > levels[i - 1] + 1).length;
        const imgs = Array.from(document.images);
        r.imgs = imgs.length;
        r.noAlt = imgs.filter((i) => !i.hasAttribute('alt')).length;
        r.emptyShotAlt = imgs.filter((i) => i.hasAttribute('data-shot') && i.getAttribute('alt').trim().length < 20).length;
        const svgs = Array.from(document.querySelectorAll('svg')).filter((s) => !s.parentElement.closest('svg'));
        r.svgs = svgs.length;
        r.svgExposed = svgs.filter((s) => !s.closest('[aria-hidden="true"], [role="img"][aria-label]') && !(s.getAttribute('role') === 'img' && s.getAttribute('aria-label'))).length;
        const buttons = Array.from(document.querySelectorAll('button'));
        r.unnamedButtons = buttons.filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim())).length;
        r.toggle = (document.getElementById('lang-toggle') || {}).tagName;
        r.lang = document.documentElement.lang;
        r.skip = !!document.querySelector('a.skip-link[href="#main"]') && !!document.getElementById('main');
        return r;
    });
    check('exactly one <h1>', a11y.h1 === 1, `${a11y.h1}`);
    check('heading levels never skip', a11y.skips === 0, `${a11y.skips} skip(s)`);
    check(`every <img> has alt (${a11y.imgs}); screenshots have real descriptions`, a11y.noAlt === 0 && a11y.emptyShotAlt === 0, `missing ${a11y.noAlt}, short ${a11y.emptyShotAlt}`);
    check(`every <svg> is decorative (aria-hidden) or labelled (${a11y.svgs})`, a11y.svgExposed === 0, `${a11y.svgExposed} exposed`);
    check('every button has an accessible name; the language toggle is a <button>', a11y.unnamedButtons === 0 && a11y.toggle === 'BUTTON', `unnamed ${a11y.unnamedButtons}, toggle <${a11y.toggle}>`);
    check('skip link to <main> exists', a11y.skip);
    const roles = {};
    for (const role of ['banner', 'navigation', 'main', 'contentinfo']) roles[role] = await page.getByRole(role).count();
    check('landmarks: banner, navigation, main, contentinfo', roles.banner === 1 && roles.navigation >= 1 && roles.main === 1 && roles.contentinfo === 1, JSON.stringify(roles));

    const weight = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        let total = nav ? (nav.transferSize || nav.encodedBodySize || 0) : 0;
        const parts = {};
        for (const e of performance.getEntriesByType('resource')) {
            if (/\.(mp4|webm)(\?|$)/.test(e.name)) continue;
            const size = e.transferSize || e.encodedBodySize || 0;
            total += size;
            const kind = /\.webp/.test(e.name) ? 'screenshots' : /\.(js)(\?|$)/.test(e.name) ? 'js' : /\.css/.test(e.name) ? 'css' : 'other';
            parts[kind] = (parts[kind] || 0) + size;
        }
        return { total, parts };
    });
    const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
    check('page weight without videos ≤ 3 MB (en, fully scrolled)', weight.total <= MAX_WEIGHT,
        `${kb(weight.total)} total — ${Object.entries(weight.parts).map(([k, v]) => `${k} ${kb(v)}`).join(', ')}`);
    check('links/a11y page: zero console problems', problems.length === 0, problems.slice(0, 5).join(' | ') || 'clean');
    await context.close();
}

async function contrast(browser, base) {
    for (const o of [
        { width: 1440, height: 900, lang: 'zh-TW', scheme: 'light' },
        { width: 1440, height: 900, lang: 'en', scheme: 'dark' },
        { width: 390, height: 844, lang: 'en', scheme: 'light', mobile: true },
        { width: 390, height: 844, lang: 'zh-TW', scheme: 'dark', mobile: true },
    ]) {
        const { context, page } = await newPage(browser, o);
        await open(page, base);
        await scrollThrough(page);
        const r = await page.evaluate(contrastAudit);
        check(`contrast ${name(o)}: ${r.checked} text elements ≥ 4.5:1 (large ≥ 3:1)`, r.failures.length === 0, r.failures.slice(0, 6).join(' | '));
        await context.close();
    }
}

async function language(browser, base) {
    for (const [locale, expect] of [['zh-TW', 'zh-TW'], ['zh-CN', 'zh-TW'], ['en-US', 'en'], ['ja-JP', 'en']]) {
        const { context, page } = await newPage(browser, { width: 1024, height: 768, scheme: 'light', locale });
        await open(page, base);
        const got = await page.evaluate(() => document.documentElement.lang);
        check(`default language for navigator.language=${locale} → ${expect}`, got === expect, `got ${got}`);
        await context.close();
    }
    const { context, page, problems } = await newPage(browser, { width: 1440, height: 900, scheme: 'light', locale: 'en-US' });
    await open(page, base);
    const before = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, label: document.getElementById('lang-toggle').textContent.trim() }));
    await page.click('#lang-toggle');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        title: document.title,
        label: document.getElementById('lang-toggle').textContent.trim(),
        stored: localStorage.getItem('urdiary-site-lang'),
        shots: Array.from(document.querySelectorAll('img[data-shot]')).every((i) => i.getAttribute('src').includes('/zh/')),
        focus: document.activeElement && document.activeElement.id,
    }));
    await page.screenshot({ path: path.join(OUT, 'interaction-language-toggled-to-zh.png') });
    check('language toggle switches <html lang>, title, labels and screenshots', before.lang === 'en' && after.lang === 'zh-TW' && after.title !== before.title && after.shots && after.label !== before.label && after.focus === 'lang-toggle',
        `${before.lang}→${after.lang}, "${before.label}"→"${after.label}", focus stays on toggle: ${after.focus === 'lang-toggle'}`);
    await page.reload();
    await page.waitForSelector('html.is-ready', { state: 'attached' });
    const persisted = await page.evaluate(() => document.documentElement.lang);
    check('language choice survives a reload (localStorage)', after.stored === 'zh-TW' && persisted === 'zh-TW', `stored ${after.stored}, after reload ${persisted}`);
    check('language page: zero console problems', problems.length === 0, problems.slice(0, 5).join(' | ') || 'clean');
    await context.close();
}

async function interactions(browser, base) {
    const { context, page, problems } = await newPage(browser, { width: 1440, height: 900, lang: 'zh-TW', scheme: 'light' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
    await open(page, base);
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });

    // eye-follow: the welcome pose looks toward the pointer
    const box = await page.locator('#hero-mascot').boundingBox();
    await page.mouse.move(box.x + box.width + 300, box.y + box.height / 2);
    await page.waitForTimeout(300);
    const look = await page.evaluate(() => (document.querySelector('#hero-mascot .mm-eyes') || {}).style.transform || '');
    const dx = parseFloat((/translate\(([-\d.]+)px/.exec(look) || [])[1] || '0');
    check('hero mascot looks toward the pointer (eye-follow)', dx > 1, `eyes ${look || 'untouched'}`);

    // tap reaction by pointer
    await page.click('#hero-mascot');
    await page.waitForTimeout(260);
    const tap = await page.evaluate(() => ({
        react: !!document.querySelector('#hero-mascot svg.mm-react'),
        heart: !!document.querySelector('#hero-mascot [data-mm-heart]'),
        hintDone: document.getElementById('tap-hint').classList.contains('is-done'),
    }));
    await page.screenshot({ path: path.join(OUT, 'interaction-hero-tap.png'), clip: { x: box.x - 140, y: box.y - 140, width: box.width + 280, height: box.height + 220 } });
    check('tapping the hero mascot: hop + happy face + heart, hint retires', tap.react && tap.heart && tap.hintDone, JSON.stringify(tap));

    // keyboard: a playground mascot reacts to Enter
    await page.locator('.pg-mascot[data-pose="diary"]').scrollIntoViewIfNeeded();
    await page.focus('.pg-mascot[data-pose="diary"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const kb = await page.evaluate(() => !!document.querySelector('.pg-mascot[data-pose="diary"] svg.mm-react'));
    check('keyboard: Enter on a playground mascot plays its reaction', kb);

    // celebrations play in their own card, one at a time, then clean up
    await page.locator('#pg-egg-happy').scrollIntoViewIfNeeded();
    await page.click('.btn-egg[data-egg="happy"]');
    await page.waitForTimeout(450);
    const egg = await page.evaluate(() => ({
        inCard: !!document.querySelector('#pg-egg-happy > .mascot-egg.mascot-egg-happy'),
        onBody: document.querySelectorAll('body > .mascot-egg').length,
        playing: document.getElementById('pg-egg-happy').classList.contains('is-playing'),
        anims: document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#pg-egg-happy')).length,
    }));
    const eggBox = await page.locator('#pg-egg-happy').boundingBox();
    await page.screenshot({ path: path.join(OUT, 'interaction-happy-hop-playing.png'), clip: { x: eggBox.x - 20, y: eggBox.y - 20, width: eggBox.width * 2 + 60, height: eggBox.height + 40 } });
    check('happy hop plays inside its card (not over the page)', egg.inCard && egg.onBody === 0 && egg.playing && egg.anims > 0, JSON.stringify(egg));
    await page.click('.btn-egg[data-egg="goodnight"]');
    await page.waitForTimeout(150);
    const swap = await page.evaluate(() => ({
        happyGone: !document.querySelector('#pg-egg-happy > .mascot-egg'),
        happyIdle: !document.getElementById('pg-egg-happy').classList.contains('is-playing'),
        night: !!document.querySelector('#pg-egg-night > .mascot-egg.mascot-egg-night'),
    }));
    check('one celebration at a time: goodnight replaces the hop cleanly', swap.happyGone && swap.happyIdle && swap.night, JSON.stringify(swap));
    await page.waitForTimeout(2200);
    const done = await page.evaluate(() => ({
        eggs: document.querySelectorAll('.mascot-egg').length,
        playing: document.querySelectorAll('.pg-egg-stage.is-playing').length,
    }));
    check('celebrations remove themselves and the stills come back', done.eggs === 0 && done.playing === 0, JSON.stringify(done));

    // lightbox
    await page.locator('#f-calendar .shot-main .zoom').scrollIntoViewIfNeeded();
    await page.click('#f-calendar .shot-main .zoom');
    await page.waitForTimeout(300);
    const lb = await page.evaluate(() => ({ open: document.getElementById('lightbox').open, src: document.getElementById('lightbox-img').getAttribute('src'), alt: document.getElementById('lightbox-img').alt }));
    await page.screenshot({ path: path.join(OUT, 'interaction-lightbox.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const lbClosed = await page.evaluate(() => ({ open: document.getElementById('lightbox').open, focus: document.activeElement && document.activeElement.classList.contains('zoom') }));
    check('screenshot lightbox opens with the image + alt, Esc closes, focus returns', lb.open && /calendar-month\.webp$/.test(lb.src) && lb.alt.length > 20 && !lbClosed.open && lbClosed.focus, `${lb.src}; focus back: ${lbClosed.focus}`);

    // copy
    await page.locator('.copy-btn[data-copy="cmd-1"]').scrollIntoViewIfNeeded();
    await page.click('.copy-btn[data-copy="cmd-1"]');
    await page.waitForTimeout(200);
    const copied = await page.evaluate(async () => ({ text: await navigator.clipboard.readText(), label: document.querySelector('.copy-btn[data-copy="cmd-1"]').textContent }));
    check('copy button copies the command and says so', copied.text.startsWith('git clone https://github.com/brian10420/URDiary.git') && copied.label === '已複製', `label "${copied.label}"`);
    check('interaction page: zero console problems', problems.length === 0, problems.slice(0, 5).join(' | ') || 'clean');
    await context.close();
}

async function media(base, browserFactory) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'urdiary-site-media-'));
    let server = null;
    try {
        fs.cpSync(SITE, tmp, { recursive: true, filter: (src) => !src.includes(`${path.sep}tools`) });
        const clip = path.join(tmp, 'media', 'hero-loop.mp4');
        const ff = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', clip], { encoding: 'utf8' });
        if (ff.status !== 0) { check('media: test clip generated', false, ff.stderr); return; }
        fs.copyFileSync(clip, path.join(tmp, 'media', 'intro-en.mp4'));
        fs.writeFileSync(path.join(tmp, 'media', 'manifest.json'), JSON.stringify({ note: 'verify-site test copy', files: ['hero-loop.mp4', 'intro-en.mp4'] }));
        server = await serve(tmp);

        // Google Chrome (H.264): the published-video path
        let chrome = null;
        try { chrome = await browserFactory({ channel: 'chrome' }); } catch (e) { check('media: Google Chrome available for the H.264 path', false, e.message); }
        if (chrome) {
            const { context, page, problems } = await newPage(chrome, { width: 1440, height: 900, lang: 'en', scheme: 'light' });
            await open(page, server.base);
            await page.waitForTimeout(1500);
            const hero = await page.evaluate(() => {
                const v = document.getElementById('hero-video');
                return { hasVideo: document.getElementById('hero-stage').classList.contains('has-video'), hidden: v.hidden, paused: v.paused, poster: (v.getAttribute('poster') || '').slice(0, 26), toggle: !document.getElementById('hero-video-toggle').hidden };
            });
            await page.screenshot({ path: path.join(OUT, 'media-hero-with-video-chrome.png') });
            check('media (Chrome, clip listed): hero switches to the looping video, poster = still mascot, pause button shown', hero.hasVideo && !hero.hidden && !hero.paused && hero.poster.startsWith('data:image/svg+xml') && hero.toggle, JSON.stringify(hero));
            await page.click('#hero-video-toggle');
            const paused = await page.evaluate(() => document.getElementById('hero-video').paused);
            check('media: the loop can be paused (WCAG 2.2.2)', paused);
            const intro = await page.evaluate(() => ({ video: !document.getElementById('intro-video').hidden, soon: !document.getElementById('intro-soon').hidden, src: document.getElementById('intro-video').getAttribute('src') }));
            await page.click('#lang-toggle');
            await page.waitForTimeout(300);
            const introZh = await page.evaluate(() => ({ video: !document.getElementById('intro-video').hidden, soon: !document.getElementById('intro-soon').hidden }));
            check('media: intro follows the language (en listed → video; zh not listed → coming soon)', intro.video && !intro.soon && intro.src === 'media/intro-en.mp4' && !introZh.video && introZh.soon, `${JSON.stringify(intro)} → ${JSON.stringify(introZh)}`);
            check('media (Chrome): zero console problems', problems.length === 0, problems.slice(0, 5).join(' | ') || 'clean');
            await context.close();
            const reduced = await newPage(chrome, { width: 1440, height: 900, lang: 'en', scheme: 'light', reduced: true });
            await open(reduced.page, server.base);
            await reduced.page.waitForTimeout(1200);
            const rv = await reduced.page.evaluate(() => ({ hasVideo: document.getElementById('hero-stage').classList.contains('has-video'), paused: document.getElementById('hero-video').paused }));
            check('media (Chrome, reduced motion): the loop does not autoplay', rv.hasVideo && rv.paused, JSON.stringify(rv));
            await reduced.context.close();
            await chrome.close();
        }

        // A listed file that cannot be decoded must fall back through onerror (live mascot, "coming soon").
        const junk = Buffer.alloc(64 * 1024);
        for (let k = 0; k < junk.length; k++) junk[k] = (k * 7919 + 13) & 0xff;
        fs.writeFileSync(path.join(tmp, 'media', 'hero-loop.mp4'), junk);
        fs.writeFileSync(path.join(tmp, 'media', 'intro-en.mp4'), junk);
        const cr = await browserFactory({});
        const { context, page, problems } = await newPage(cr, { width: 1440, height: 900, lang: 'en', scheme: 'light' });
        await open(page, server.base);
        await page.waitForTimeout(1500);
        const fb = await page.evaluate(() => ({
            hasVideo: document.getElementById('hero-stage').classList.contains('has-video'),
            heroHidden: document.getElementById('hero-video').hidden,
            heroSrc: document.getElementById('hero-video').getAttribute('src'),
            mascot: !!document.querySelector('#hero-mascot svg'),
            introHidden: document.getElementById('intro-video').hidden,
            soon: !document.getElementById('intro-soon').hidden,
        }));
        await page.screenshot({ path: path.join(OUT, 'media-fallback-broken-file.png') });
        check('media (corrupt listed file): onerror falls back to the live mascot and "coming soon"', !fb.hasVideo && fb.heroHidden && fb.heroSrc === null && fb.mascot && fb.introHidden && fb.soon, JSON.stringify(fb));
        check('media (corrupt listed file): zero console problems', problems.length === 0, problems.slice(0, 5).join(' | ') || 'clean');
        await context.close();
        await cr.close();
    } finally {
        const stopped = await stop(server);
        if (server) check(`media: test server on ${server.port} stopped`, stopped);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// ------------------------------------------------------------------ main
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const pre = [
        ['i18n key parity (tools/check-i18n.js)', 'node', [path.join(__dirname, 'check-i18n.js')]],
        ['vendor copies byte-identical to desktop/ (sync-mascot.sh --check)', 'bash', [path.join(__dirname, 'sync-mascot.sh'), '--check']],
        ['media manifest up to date (media-manifest.js --check)', 'node', [path.join(__dirname, 'media-manifest.js'), '--check']],
    ];
    for (const [label, cmd, argv] of pre) {
        const r = spawnSync(cmd, argv, { encoding: 'utf8' });
        const lines = `${r.stdout}${r.stderr}`.trim().split('\n');
        check(label, r.status === 0, lines[lines.length - 1]);
    }
    const server = await serve(SITE);
    console.log(`serving site/ at ${server.base}`);
    const browser = await chromium.launch();
    try {
        await matrix(browser, server.base);
        await overflowNarrow(browser, server.base);
        await linksAndA11y(browser, server.base);
        await contrast(browser, server.base);
        await language(browser, server.base);
        await interactions(browser, server.base);
    } finally {
        await browser.close();
        const stopped = await stop(server);
        check(`site server on ${server.port} stopped`, stopped);
    }
    if (!SKIP_MEDIA) await media(server.base, (opts) => chromium.launch(opts));
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${OUT}`);
    process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
