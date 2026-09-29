// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * v2.6 motion Task 4：全域 reduced-motion＝靜態 的 CSS 靜態檢查。
 *
 * jsdom 不算 @media，所以這裡直接讀 CSS 原文：每個宣告了 animation（值不是 none）的
 * 選擇器，都必須在同一個檔案的 @media (prefers-reduced-motion: reduce) 區塊裡被設成
 * animation: none——之後任何任務新增動畫卻忘了靜態版，這支測試就會紅。
 * 比對時把選擇器裡的 :not(...) 拿掉再比（reduce 區塊用較寬的選擇器蓋掉即可），
 * 空白正規化。瀏覽器層面的「reduce 下每個場景影格都相同」另由
 * `node tools/motion/capture-frames.js --reduced` 驗。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_DIR = path.resolve(__dirname, '..', 'css');
const FILES = ['animations.css', 'chat.css', 'mascot.css'];

/** 頂層區塊切分：[{ prelude, body }]，body 是大括號內原文（巢狀大括號完整保留）。 */
function blocks(css) {
    const out = [];
    let i = 0; let segStart = 0;
    while (i < css.length) {
        const ch = css[i];
        if (ch === ';') { segStart = i + 1; i++; continue; }
        if (ch === '{') {
            const prelude = css.slice(segStart, i).trim();
            let depth = 1; let j = i + 1;
            while (j < css.length && depth > 0) {
                if (css[j] === '{') depth++;
                else if (css[j] === '}') depth--;
                j++;
            }
            out.push({ prelude, body: css.slice(i + 1, j - 1) });
            i = j; segStart = j;
            continue;
        }
        i++;
    }
    return out;
}

const norm = (sel) => sel.replace(/:not\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
const isReducedMedia = (prelude) => /^@media[^{]*prefers-reduced-motion\s*:\s*reduce/.test(prelude);
const ANIMATED = /(^|[;\s])animation(-name)?\s*:\s*(?!none\b)[^;]+/;
const ANIMATION_NONE = /(^|[;\s])animation(-name)?\s*:\s*none\b/;

function scan(css) {
    const animated = new Set();
    const neutralised = new Set();
    (function walk(list, inReduced) {
        for (const { prelude, body } of list) {
            if (prelude.startsWith('@keyframes') || prelude.startsWith('@-webkit-keyframes')) continue;
            if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
                walk(blocks(body), inReduced || isReducedMedia(prelude));
                continue;
            }
            const selectors = prelude.split(',').map(norm).filter(Boolean);
            if (inReduced && ANIMATION_NONE.test(body)) selectors.forEach((s) => neutralised.add(s));
            if (!inReduced && ANIMATED.test(body)) selectors.forEach((s) => animated.add(s));
        }
    })(blocks(css.replace(/\/\*[\s\S]*?\*\//g, '')), false);
    return { animated: [...animated], neutralised };
}

describe('reduced-motion＝靜態：每個動畫選擇器都有 animation:none 的 reduce 版', () => {
    it('解析器自我檢查：抓得到已知的動畫與 reduce 區塊（避免正規式失配後空轉假綠燈）', () => {
        const { animated, neutralised } = scan(fs.readFileSync(path.join(CSS_DIR, 'mascot.css'), 'utf8'));
        expect(animated).toContain('.mascot-sway');
        expect(neutralised.has('.mascot-sway')).toBe(true);
    });

    it.each(FILES)('%s', (file) => {
        const { animated, neutralised } = scan(fs.readFileSync(path.join(CSS_DIR, file), 'utf8'));
        expect(animated.length).toBeGreaterThan(0);
        const uncovered = animated.filter((sel) => !neutralised.has(sel));
        expect(uncovered, `${file} 缺 reduced-motion 靜態版：${uncovered.join(' | ')}`).toEqual([]);
    });
});
