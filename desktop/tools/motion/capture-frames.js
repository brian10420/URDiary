#!/usr/bin/env node
/**
 * 影格擷取＋contact sheet（v2.6 motion Task 3；Fable 在每個視覺任務後用它審影格）。
 *
 * 用法（cwd = desktop/）：
 *   node tools/motion/capture-frames.js                  # 全部場景
 *   node tools/motion/capture-frames.js blink react-welcome   # 指定場景
 *   node tools/motion/capture-frames.js --reduced        # 模擬 prefers-reduced-motion: reduce，
 *                                                        # 並「斷言」每個場景各影格完全相同（=靜態）
 *   node tools/motion/capture-frames.js --out <dir>      # 預設 <os tmp>/urdiary-motion-frames
 *
 * 輸出：<out>/contact-sheet.png（每列一個場景、每欄一個時間點）＋ <out>/frames/<場景>@<ms>.png。
 * 輸出一律在 git 之外（預設 os.tmpdir()）。
 *
 * 決定性：先 page.clock.install() 讓 setTimeout／rAF 停住（場景的收尾計時器不會在擷取中途
 * 移除 class），setup 之後暫停 document.getAnimations() 的全部動畫（含 CSS transition、
 * View Transition 偽元素動畫），每個影格把全部動畫 seek 到同一個 currentTime 再截圖。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const HARNESS = pathToFileURL(path.join(__dirname, 'harness.html')).href;

function parseArgs(argv) {
    const args = { scenes: [], reduced: false, out: path.join(os.tmpdir(), 'urdiary-motion-frames') };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--reduced') args.reduced = true;
        else if (argv[i] === '--out') args.out = argv[++i];
        else args.scenes.push(argv[i]);
    }
    return args;
}

async function captureScene(browser, name, reduced) {
    const context = await browser.newContext({ deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.clock.install({ time: new Date('2026-10-01T10:00:00') });
    await page.goto(HARNESS);
    // 先定視窗大小再 setup：場景可能依 innerWidth 放游標，而 View Transition 遇到視窗改尺寸會被跳過
    const viewport = await page.evaluate((n) => window.MotionHarness.SCENES[n].viewport, name);
    await page.setViewportSize({ width: viewport[0], height: viewport[1] });
    const meta = await page.evaluate((n) => window.MotionHarness.setup(n), name);
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
    const shots = [];
    for (const t of meta.frames) {
        await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), t);
        shots.push({ t, png: await page.screenshot() });
    }
    await context.close();
    if (errors.length) throw new Error(`scene ${name}: page error ${errors.join(' | ')}`);
    return shots;
}

async function contactSheet(browser, rows, outFile) {
    const cells = rows.map(({ name, shots }) => `<tr><th>${name}</th>${shots.map(({ t, png }) =>
        `<td><img src="data:image/png;base64,${png.toString('base64')}"><div>${t} ms</div></td>`).join('')}</tr>`).join('');
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 900 } });
    await page.setContent(`<!doctype html><style>
        body{margin:12px;font:13px sans-serif;background:#fafafa}
        th{text-align:right;padding:6px 10px;vertical-align:middle;white-space:nowrap}
        td{padding:6px;text-align:center;vertical-align:top}
        img{max-width:260px;max-height:260px;border:1px solid #ddd;background:#fff;display:block}
    </style><table>${cells}</table>`);
    await page.screenshot({ path: outFile, fullPage: true });
    await page.close();
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const browser = await chromium.launch();
    try {
        const probe = await browser.newPage();
        await probe.goto(HARNESS);
        const all = await probe.evaluate(() => window.MotionHarness.list());
        await probe.close();
        const names = args.scenes.length ? args.scenes : all;
        const unknown = names.filter((n) => !all.includes(n));
        if (unknown.length) throw new Error(`unknown scene(s): ${unknown.join(', ')}；可用：${all.join(', ')}`);

        fs.mkdirSync(path.join(args.out, 'frames'), { recursive: true });
        const rows = [];
        const moving = [];
        for (const name of names) {
            const shots = await captureScene(browser, name, args.reduced);
            shots.forEach(({ t, png }) => fs.writeFileSync(path.join(args.out, 'frames', `${name}@${t}.png`), png));
            if (shots.some(({ png }) => Buffer.compare(png, shots[0].png) !== 0)) moving.push(name);
            rows.push({ name, shots });
        }
        const sheet = path.join(args.out, args.reduced ? 'contact-sheet-reduced.png' : 'contact-sheet.png');
        await contactSheet(browser, rows, sheet);
        console.log(`contact sheet: ${sheet}`);
        console.log(`frames:        ${path.join(args.out, 'frames')}`);
        if (args.reduced) {
            if (moving.length) {
                console.log(`REDUCED-MOTION VIOLATION (frames differ): ${moving.join(', ')}`);
                process.exitCode = 1;
            } else {
                console.log(`reduced motion: all ${names.length} scenes static`);
            }
        } else {
            const still = names.filter((n) => !moving.includes(n));
            if (still.length) console.log(`note: no motion captured in: ${still.join(', ')}`);
        }
    } finally {
        await browser.close();
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
