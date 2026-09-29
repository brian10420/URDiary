#!/usr/bin/env node
/**
 * 吉祥物靜止畫面的像素同一性檢查（v2.6 motion Task 2；之後每個視覺任務都跑）。
 *
 * 用法（cwd = desktop/）：
 *   node tools/motion/pose-identity.js               # 基準 = git merge-base HEAD main
 *   node tools/motion/pose-identity.js --base <ref>  # 指定基準 commit
 *   node tools/motion/pose-identity.js --out <dir>   # 差異 PNG 輸出（預設 <os tmp>/urdiary-pose-identity）
 *
 * 做法：同一份渲染清單（MascotModule 每個對外 API 的姿勢、兩種存日記彩蛋、七分類
 * 圖標 18/24、24 款印章 14/20/40）分別用「基準版 js/mascot.js」與「工作樹版」在 jsdom
 * 產出 HTML，再用 Playwright chromium（deviceScaleFactor 2）逐筆截圖、比對 PNG 位元組。
 *   模式 A：不載任何 CSS——純 SVG 幾何。rig 只准「包群組」，一筆一畫都不能變。
 *   模式 B：各自載入自己版本的 css/mascot.css、取消所有動畫——新 CSS 的「靜態」規則
 *           （visibility、transform-origin、顏色…）不得偷改靜止外觀。兩筆彩蛋不比 B
 *           （Task 8 會刻意改彩蛋的呈現）。
 * 只比「兩邊都有」的名稱；工作樹新增的渲染列為 new（不算失敗），基準有、工作樹沒有的
 * 列為 missing（算失敗）。任何失敗：印出名稱、把 base／head 兩張 PNG 寫進 --out，
 * exit code 1。這支工具不進 app shell：tools/ 不在 index.html、不在 sw.js 的
 * SHELL_ASSETS，後端也沒掛這個目錄。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');
const { chromium } = require('playwright');

const DESKTOP_ROOT = path.resolve(__dirname, '..', '..');
const CATEGORIES = ['work', 'study', 'health', 'family', 'anniversary', 'other', 'travel'];
const STAMPS = ['cake', 'gift', 'heart', 'cheers', 'trophy', 'flag', 'book', 'star',
    'plane', 'camera', 'ball', 'movie', 'music', 'food', 'coffee', 'flower',
    'sun', 'umbrella', 'moon', 'rainbow', 'sprout', 'heal', 'paw', 'gradcap'];
const EGG_NAMES = new Set(['egg-happy', 'egg-goodnight']);

function parseArgs(argv) {
    const args = { base: null, out: path.join(os.tmpdir(), 'urdiary-pose-identity') };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--base') args.base = argv[++i];
        else if (argv[i] === '--out') args.out = argv[++i];
    }
    return args;
}

function git(args) {
    return execFileSync('git', args, { cwd: DESKTOP_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function resolveBase(ref) {
    if (ref) return ref;
    try { return git(['merge-base', 'HEAD', 'main']).trim(); } catch (e) { return 'main'; }
}

/** 在 jsdom 裡跑某個版本的 mascot.js，回傳 [{name, html}]。 */
function collectRenders(mascotSource) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
    try {
        dom.window.eval(mascotSource);
        const M = dom.window.MascotModule;
        const doc = dom.window.document;
        const out = [];
        const add = (name, html) => out.push({ name, html });
        add('loading-96', M.loadingHtml(96));
        add('loading-26', M.loadingHtml(26));
        add('thinking', M.thinkingBubbleHtml());
        add('empty-diary', M.emptyHtml('diary', ''));
        add('empty-calendar', M.emptyHtml('calendar', ''));
        add('empty-generic', M.emptyHtml('generic', ''));
        add('welcome', M.welcomeHtml());
        add('checkin', M.checkinHtml());
        for (const kind of ['happy', 'goodnight']) {
            M.showSaveEgg(kind);
            const egg = doc.querySelector('.mascot-egg');
            add('egg-' + kind, egg.innerHTML);   // 只比 SVG 本體，外層 fixed 版位不比
            egg.remove();
        }
        for (const c of CATEGORIES) for (const size of [18, 24]) add(`cat-${c}-${size}`, M.categoryIcon(c, size));
        for (const id of STAMPS) for (const size of [14, 20, 40]) add(`stamp-${id}-${size}`, M.stampIcon(id, size));
        return out;
    } finally {
        dom.window.close();   // 清掉 showSaveEgg 排的 setTimeout，process 才會正常結束
    }
}

async function shootAll(browser, renders, css) {
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 480, height: 360 } });
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><head><style>' +
        'html,body{margin:0;background:#fff}#cell{display:inline-block;padding:6px;background:#fff}' +
        '</style>' + (css ? `<style>${css}</style>` : '') + '</head><body></body></html>');
    const shots = new Map();
    for (const r of renders) {
        await page.evaluate((html) => {
            document.body.innerHTML = `<div id="cell">${html}</div>`;
            // 取消所有動畫：只看「靜態 CSS」的效果。不用「暫停在 t=0」——跑動畫的 SVG
            // 群組會被提升成合成層、邊緣反鋸齒跟著變，位元組永遠對不上（實測）。t=0
            // 的姿勢是否等於靜止姿勢，交給 capture-frames.js 的影格審查。
            document.getAnimations().forEach((a) => a.cancel());
        }, r.html);
        shots.set(r.name, await page.locator('#cell').screenshot());
    }
    await context.close();
    return shots;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const base = resolveBase(args.base);
    const baseJs = git(['show', `${base}:desktop/js/mascot.js`]);
    const baseCss = git(['show', `${base}:desktop/css/mascot.css`]);
    const headJs = fs.readFileSync(path.join(DESKTOP_ROOT, 'js', 'mascot.js'), 'utf8');
    const headCss = fs.readFileSync(path.join(DESKTOP_ROOT, 'css', 'mascot.css'), 'utf8');

    const baseRenders = collectRenders(baseJs);
    const headRenders = collectRenders(headJs);
    const headNames = new Set(headRenders.map((r) => r.name));
    const baseNames = new Set(baseRenders.map((r) => r.name));
    const missing = [...baseNames].filter((n) => !headNames.has(n));
    const fresh = [...headNames].filter((n) => !baseNames.has(n));
    const common = (list) => list.filter((r) => baseNames.has(r.name) && headNames.has(r.name));

    const browser = await chromium.launch();
    const failures = [];
    try {
        for (const mode of ['A', 'B']) {
            const pick = (list) => common(list).filter((r) => mode === 'A' || !EGG_NAMES.has(r.name));
            const b = await shootAll(browser, pick(baseRenders), mode === 'B' ? baseCss : null);
            const h = await shootAll(browser, pick(headRenders), mode === 'B' ? headCss : null);
            for (const [name, png] of b) {
                if (Buffer.compare(png, h.get(name)) !== 0) {
                    fs.mkdirSync(args.out, { recursive: true });
                    fs.writeFileSync(path.join(args.out, `${mode}-${name}.base.png`), png);
                    fs.writeFileSync(path.join(args.out, `${mode}-${name}.head.png`), h.get(name));
                    failures.push(`${mode}:${name}`);
                }
            }
            console.log(`mode ${mode}: compared ${b.size} renders`);
        }
    } finally {
        await browser.close();
    }

    console.log(`base = ${base}`);
    if (fresh.length) console.log(`new (not compared): ${fresh.join(', ')}`);
    if (missing.length) console.log(`MISSING in head: ${missing.join(', ')}`);
    if (failures.length) console.log(`PIXEL DIFF: ${failures.join(', ')}  →  ${args.out}`);
    if (missing.length || failures.length) {
        process.exitCode = 1;
        return;
    }
    console.log('pose identity: OK (all common renders pixel-identical)');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
