#!/usr/bin/env node
/**
 * Renders the 1200×630 link-preview card (tools/og-card.html) to site/assets/og-image.png.
 * Serves site/ itself with `python3 -m http.server` on a free port ≥ 8130 and stops it after.
 * Run site/tools/sync-mascot.sh first (the card uses vendor/mascot.js like the page does).
 *
 *   node site/tools/render-og.js
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
const PY = process.env.PILLOW_PYTHON || '/mnt/Data_SSD/ComfyUI/.venv/bin/python';
const OUT = path.join(SITE, 'assets', 'og-image.png');

function freePort(start) {
    return new Promise((resolve, reject) => {
        const tryPort = (p) => {
            if (p > start + 60) { reject(new Error('no free port')); return; }
            const srv = net.createServer();
            srv.once('error', () => tryPort(p + 1));
            srv.once('listening', () => srv.close(() => resolve(p)));
            srv.listen(p, '127.0.0.1');
        };
        tryPort(start);
    });
}

function statusOf(url) {
    return new Promise((resolve) => {
        http.get(url, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0));
    });
}

async function waitForServer(url) {
    for (let i = 0; i < 50; i++) {
        if (await statusOf(url) === 200) return;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`server did not start: ${url}`);
}

(async () => {
    if (!fs.existsSync(path.join(SITE, 'vendor', 'mascot.js'))) {
        console.error('render-og: site/vendor/mascot.js missing — run site/tools/sync-mascot.sh first');
        process.exit(2);
    }
    const port = await freePort(8130);
    const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', SITE], { stdio: 'ignore' });
    const tmp = path.join(os.tmpdir(), `urdiary-og-${process.pid}.png`);
    try {
        await waitForServer(`http://127.0.0.1:${port}/tools/og-card.html`);
        const browser = await chromium.launch();
        const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        await page.goto(`http://127.0.0.1:${port}/tools/og-card.html`);
        await page.waitForSelector('html[data-ready="1"]');
        await page.waitForTimeout(300);
        await page.screenshot({ path: tmp });
        await browser.close();
        const r = spawnSync(PY, ['-c', [
            'import sys',
            'from PIL import Image',
            'im = Image.open(sys.argv[1]).convert("RGB")',
            'im.save(sys.argv[2], "PNG", optimize=True)',
            'import os; print("og-image.png %dx%d %.1f KB" % (im.width, im.height, os.path.getsize(sys.argv[2]) / 1024))',
        ].join('\n'), tmp, OUT], { encoding: 'utf8' });
        if (r.status !== 0) throw new Error(r.stderr || r.stdout);
        console.log(r.stdout.trim());
    } finally {
        server.kill();
        fs.rmSync(tmp, { force: true });
    }
})().catch((e) => { console.error(e); process.exit(1); });
