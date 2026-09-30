#!/usr/bin/env node
/**
 * Re-shoots the showcase screenshots (site/assets/screens/{zh,en}/*.webp) from the REAL app,
 * served by the isolated demo backend — never from the everyday backend or the repo's data/.
 *
 * Prerequisites (details in promo/demo/README.md; run from the repo root):
 *   export URDIARY_DATA_DIR=$(mktemp -d /tmp/urdiary-demo-XXXXXX)
 *   .venv/bin/python promo/demo/seed_demo.py                                   # fictional personas 語晴 / Maya
 *   .venv/bin/python promo/demo/seed_demo.py --user yuqing,maya --set-checkin today   # no stub greeting
 *   promo/demo/run_demo_backend.sh --stub &                                    # 127.0.0.1:8124, stub LLM
 *   node site/tools/capture-screens.js [--base http://127.0.0.1:8124] [--month 2026-09] [--only name,name]
 *
 * No shot shows LLM output: the stub backend only serves seeded data, and the onboarding
 * intro / naming lines are scripted in the app (desktop/js/i18n.js), not generated.
 * The hello accounts are consumed by the onboarding shot (the name gets saved); re-running
 * that shot needs `seed_demo.py --reset-hello` first.
 *
 * PNG → WebP goes through Pillow (default interpreter: the ComfyUI venv; override with
 * PILLOW_PYTHON=/path/to/python). Every file must end up ≤ 250 KB.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SITE = path.resolve(__dirname, '..');
const REPO = path.resolve(SITE, '..');
const { chromium } = require(path.join(REPO, 'desktop', 'node_modules', 'playwright'));

const args = process.argv.slice(2);
function opt(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE = opt('--base', 'http://127.0.0.1:8124').replace(/\/+$/, '');
const MONTH = opt('--month', '2026-09');                    // the seeded month with 15 stamped days
const ONLY = (opt('--only', '') || '').split(',').filter(Boolean);
const OUT_DIR = path.join(SITE, 'assets', 'screens');
const PY = process.env.PILLOW_PYTHON || '/mnt/Data_SSD/ComfyUI/.venv/bin/python';
const MAX_BYTES = 250 * 1024;

// Refuse the everyday backend (8001) and the E2E backend (8123) outright.
const port = new URL(BASE).port;
if (port === '8001' || port === '8123') {
    console.error(`capture-screens: REFUSED: ${BASE} is not the isolated demo backend (use 8124)`);
    process.exit(2);
}

const LANGS = [
    { code: 'zh-TW', dir: 'zh', locale: 'zh-TW', user: 'yuqing', hello: 'yuqing_hello', pw: 'treehole-demo-zh', name: '小樹洞' },
    { code: 'en', dir: 'en', locale: 'en-US', user: 'maya', hello: 'maya_hello', pw: 'treehole-demo-en', name: 'Treehole' },
];

// Fixed clip sizes (CSS px) so the zh and en files of a shot have identical dimensions —
// the page reserves their aspect ratio with width/height attributes (no layout shift on
// language switch). Anchored at the element's top-left corner.
const SHOTS = {
    'onboarding':       { viewport: [820, 980] },
    'diary-list':       { viewport: [1024, 900] },
    'diary-detail':     { viewport: [1024, 900] },
    'calendar-month':   { viewport: [1024, 768] },
    'calendar-day':     { viewport: [1024, 768], size: [320, 250] },
    'memory-ledger':    { viewport: [1024, 820] },
    'settings-provider': { viewport: [1024, 820] },
    'mobile-diary':     { viewport: [390, 844], mobile: true },
    'mobile-calendar':  { viewport: [390, 844], mobile: true },
};

function wanted(name) { return ONLY.length === 0 || ONLY.includes(name); }

async function newPage(browser, lang, shot) {
    const [width, height] = shot.viewport;
    const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 2,
        isMobile: !!shot.mobile,
        hasTouch: !!shot.mobile,
        locale: lang.locale,
        timezoneId: 'Asia/Taipei',
        colorScheme: 'light',
        reducedMotion: 'reduce',          // static mascots, no transitions → deterministic frames
    });
    await context.addInitScript((code) => {
        try { localStorage.setItem('urDiary_language', code); } catch (e) { /* ignore */ }
    }, lang.code);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.warn(`  [${lang.dir}] page error: ${e.message}`));
    return page;
}

async function login(page, user, pw) {
    await page.goto(`${BASE}/`);
    await page.locator('#user-select-dialog').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('.user-item[data-username=""]').click();
    await page.fill('#login-username', user);
    await page.fill('#user-password', pw);
    await page.click('#verify-password-btn');
    await page.locator('#password-dialog').waitFor({ state: 'hidden', timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await settle(page);
}

/** Let async renders land, drop focus rings / carets, wait out any egg overlay. */
async function settle(page, ms = 600) {
    await page.waitForTimeout(ms);
    await page.locator('.mascot-egg').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
}

async function box(page, selector) {
    const b = await page.locator(selector).first().boundingBox();
    if (!b) throw new Error(`no box for ${selector}`);
    return b;
}

function clipAt(b, size) {
    return { x: Math.round(b.x), y: Math.round(b.y), width: size[0], height: size[1] };
}

async function goView(page, view, mobile) {
    const sel = mobile ? `.tab-bar .nav-item[data-view="${view}"]` : `.app-nav .nav-item[data-view="${view}"]`;
    await page.click(sel);
    await settle(page, 1200);
}

async function showMonth(page) {
    const [y, m] = MONTH.split('-').map(Number);
    // The toolbar label is locale-formatted; compare against the rendered month of the grid instead.
    for (let i = 0; i < 24; i++) {
        const cur = await page.evaluate(() => {
            const cell = document.querySelector('.calendar-grid .calendar-cell:not(.other-month)[data-date], .calendar-grid .calendar-cell[data-date]');
            return cell ? cell.getAttribute('data-date') : null;
        });
        if (!cur) break;
        // pick a mid-grid cell (always inside the displayed month)
        const mid = await page.evaluate(() => {
            const cells = document.querySelectorAll('.calendar-grid .calendar-cell[data-date]');
            return cells.length ? cells[Math.floor(cells.length / 2)].getAttribute('data-date') : null;
        });
        const [cy, cm] = (mid || cur).split('-').map(Number);
        const diff = (y - cy) * 12 + (m - cm);
        if (diff === 0) return;
        await page.click(diff < 0 ? '#calendar-prev-btn' : '#calendar-next-btn');
        await settle(page, 700);
    }
}

async function clickDay(page, day) {
    const [y, m] = MONTH.split('-').map(Number);
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = page.locator(`.calendar-grid .calendar-cell[data-date="${iso}"]`);
    if (await cell.count()) { await cell.first().click(); }
    else {
        // fallback: match by the visible day number within the month
        const cells = page.locator('.calendar-grid .calendar-cell');
        const n = await cells.count();
        for (let i = 7; i < n; i++) {
            const t = ((await cells.nth(i).innerText()) || '').trim().split('\n')[0];
            if (t === String(day)) { await cells.nth(i).click(); break; }
        }
    }
    await settle(page, 900);
}

const CAPTURE = {
    async 'onboarding'(page, lang) {
        await login(page, lang.hello, lang.pw);
        await page.locator('[data-onboarding-start-chat]').first().waitFor({ state: 'visible', timeout: 30000 });
        await settle(page, 800);
        await page.fill('#user-input', lang.name);
        await page.keyboard.press('Enter');
        // the scripted namingAck, then the next scripted question with its chips
        await page.locator('.chat-messages').getByText(lang.name + (lang.dir === 'zh' ? '——' : ' —'), { exact: false })
            .first().waitFor({ timeout: 30000 });
        await page.locator('[data-onboarding-start-chat]').last().waitFor({ state: 'visible', timeout: 30000 });
        await page.locator('.chat-message.thinking').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
        await settle(page, 1200);
        // Size the viewport so the message list starts exactly at the naming question
        // (the chat is pinned to the bottom; a partly hidden bubble under the header looks broken).
        const needle = lang.dir === 'zh' ? '取個名字' : 'give me a name';
        const offsetOfNaming = () => page.evaluate((text) => {
            const list = document.querySelector('#chat-view .chat-messages');
            list.scrollTop = list.scrollHeight;
            const row = Array.from(list.querySelectorAll('.chat-message')).find((m) => m.textContent.includes(text));
            return row.getBoundingClientRect().top - list.getBoundingClientRect().top;
        }, needle);
        for (let i = 0; i < 3; i++) {
            const top = await offsetOfNaming();
            if (Math.abs(top - 18) < 2) break;
            const vp = page.viewportSize();
            await page.setViewportSize({ width: vp.width, height: Math.round(vp.height + (18 - top)) });
            await settle(page, 500);
        }
        await offsetOfNaming();
        const head = await box(page, '#chat-view .chat-header');
        const msgs = await box(page, '#chat-view .chat-messages');
        return { x: Math.round(head.x), y: Math.round(head.y), width: Math.round(head.width), height: Math.round(msgs.y + msgs.height - head.y) };
    },
    async 'diary-list'(page, lang) {
        await login(page, lang.user, lang.pw);
        await goView(page, 'diary');
        await page.locator('.diary-card').first().click();          // list + detail side by side
        await settle(page, 1000);
        const b = await box(page, '.diary-list');
        return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    },
    async 'diary-detail'(page, lang) {
        await login(page, lang.user, lang.pw);
        await goView(page, 'diary');
        await page.locator('.diary-card').first().click();
        await settle(page, 1000);
        const b = await box(page, '.diary-detail');
        return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    },
    async 'calendar-month'(page, lang) {
        await login(page, lang.user, lang.pw);
        await goView(page, 'calendar');
        await showMonth(page);
        await page.mouse.move(1, 1);
        await settle(page);
        const bar = await box(page, '.calendar-toolbar');
        const grid = await box(page, '.calendar-grid');
        return { x: Math.round(grid.x) - 8, y: Math.round(bar.y) - 8, width: Math.round(grid.width) + 16, height: Math.round(grid.y + grid.height - bar.y) + 16 };
    },
    async 'calendar-day'(page, lang, shot) {
        await login(page, lang.user, lang.pw);
        await goView(page, 'calendar');
        await showMonth(page);
        await clickDay(page, 23);                    // D-7: the rainy "quiet day" (umbrella stamp)
        await page.mouse.move(1, 1);
        await settle(page);
        return clipAt(await box(page, '.calendar-day-panel'), shot.size);
    },
    async 'memory-ledger'(page, lang) {
        await login(page, lang.user, lang.pw);
        await page.click('#settings-btn');
        await settle(page, 1000);
        await page.click('#settings-memory-manage');
        await settle(page, 1000);
        await page.click('#memory-tab-ledger');
        await settle(page, 1000);
        const b = await box(page, '#memory-dialog .modal-content');
        const vh = SHOTS['memory-ledger'].viewport[1];
        return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.min(Math.round(b.height), vh - Math.round(b.y) - 24) };
    },
    async 'settings-provider'(page, lang) {
        await login(page, lang.user, lang.pw);
        await page.click('#settings-btn');
        await settle(page, 1000);
        await page.selectOption('#settings-provider', 'local');   // shows Base URL (localhost:11434) — not saved
        await settle(page, 600);
        const b = await box(page, '#settings-dialog .modal-content');
        const row = await box(page, '#settings-base-url-row');
        return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(row.y + row.height - b.y) + 18 };
    },
    async 'mobile-diary'(page, lang) {
        await login(page, lang.user, lang.pw);
        await goView(page, 'diary', true);
        return null;   // full viewport
    },
    async 'mobile-calendar'(page, lang) {
        await login(page, lang.user, lang.pw);
        await goView(page, 'calendar', true);
        await showMonth(page);
        await clickDay(page, 23);
        return null;
    },
};

// Pillow step: pad every language's PNG of one shot to the largest width/height (with the colour of
// its own bottom-right corner — flat UI background), then encode WebP: lossless when it is not much
// bigger than lossy (crisper text), otherwise the highest lossy quality that fits under the cap.
const PY_CODE = `
import io, json, sys
from PIL import Image
jobs, cap = json.loads(sys.argv[1]), int(sys.argv[2])
ims = [Image.open(j["png"]).convert("RGB") for j in jobs]
W, H = max(i.width for i in ims), max(i.height for i in ims)
for job, im in zip(jobs, ims):
    if im.size != (W, H):
        canvas = Image.new("RGB", (W, H), im.getpixel((im.width - 1, im.height - 1)))
        canvas.paste(im, (0, 0))
        im = canvas
    def enc(**kw):
        b = io.BytesIO(); im.save(b, "WEBP", method=6, **kw); return b.getvalue()
    lossless, pick = enc(lossless=True, quality=100), None
    for q in (88, 84, 80, 76, 72, 68, 64, 60):
        data = enc(quality=q)
        if len(data) <= cap:
            pick = ("q%d" % q, data); break
    if len(lossless) <= cap and (pick is None or len(lossless) <= len(pick[1]) * 1.2):
        pick = ("lossless", lossless)
    if pick is None:
        sys.exit("too big even at q60: " + job["png"])
    open(job["webp"], "wb").write(pick[1])
    print("%s %dx%d %s %.1f KB" % (job["label"], W, H, pick[0], len(pick[1]) / 1024))
`;

function encodeShot(jobs) {
    const r = spawnSync(PY, ['-c', PY_CODE, JSON.stringify(jobs), String(MAX_BYTES)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`webp conversion failed: ${r.stderr || r.stdout}`);
    return r.stdout.trim();
}

(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'urdiary-shots-'));
    const browser = await chromium.launch();
    try {
        for (const [name, shot] of Object.entries(SHOTS)) {
            if (!wanted(name)) continue;
            const jobs = [];
            for (const lang of LANGS) {
                fs.mkdirSync(path.join(OUT_DIR, lang.dir), { recursive: true });
                const page = await newPage(browser, lang, shot);
                try {
                    const clip = await CAPTURE[name](page, lang, shot);
                    const png = path.join(tmp, `${lang.dir}-${name}.png`);
                    await page.screenshot(clip ? { path: png, clip } : { path: png });
                    jobs.push({ png, webp: path.join(OUT_DIR, lang.dir, `${name}.webp`), label: `${lang.dir}/${name}.webp` });
                } finally {
                    await page.context().close();
                }
            }
            console.log(encodeShot(jobs));
        }
    } finally {
        await browser.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
})().catch((e) => { console.error(e); process.exit(1); });
