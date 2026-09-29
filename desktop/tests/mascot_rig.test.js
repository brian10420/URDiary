// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 2：吉祥物 rig 化的結構契約。
 *
 * 像素層面的「靜止畫面不變」由 tools/motion/pose-identity.js 驗（需要真瀏覽器）；
 * 這裡釘住 jsdom 就驗得到的結構：每個姿勢都有具名部件群組、群組不帶 transform
 * 屬性（CSS 動畫才掛得上去）、繪製順序正確、原本的每一筆圖元都還在。
 */

/** 各對外渲染 → 預期結構。prims＝rig 化之前（main@7210700）量到的圖元數。 */
const EXPECT = {
    loading:          { pose: 'smile',     eyes: 'dot',    blush: 0, armR: 0, prims: 6 },
    thinking:         { pose: 'smile',     eyes: 'dot',    blush: 0, armR: 0, prims: 6 },
    'empty-diary':    { pose: 'sleep',     eyes: 'closed', blush: 0, armR: 0, prims: 9 },
    'empty-calendar': { pose: 'calendar',  eyes: 'dot',    blush: 0, armR: 1, prims: 14 },
    'empty-generic':  { pose: 'question',  eyes: 'dot',    blush: 0, armR: 0, prims: 7 },
    welcome:          { pose: 'wave',      eyes: 'happy',  blush: 1, armR: 1, prims: 9 },
    checkin:          { pose: 'tea',       eyes: 'dot',    blush: 0, armR: 1, prims: 10 },
    'egg-happy':      { pose: 'jump',      eyes: 'happy',  blush: 0, armR: 0, prims: 9 },
    'egg-goodnight':  { pose: 'goodnight', eyes: 'closed', blush: 1, armR: 0, prims: 15 },
};

/**
 * 「靜止畫面」範圍：之後的任務會在部分姿勢放「靜止時不畫」的動畫零件——點擊反應的
 * 開心臉（.mm-face-alt，visibility="hidden"）、存日記彩蛋的翻頁紙（opacity="0"）。
 * 它們不屬於靜止畫面，結構與圖元數都不算。
 */
const REST_FACE = '.mm-face:not(.mm-face-alt)';
const atRest = (el) => !el.closest('[visibility="hidden"], [opacity="0"]');
const restAll = (svg, sel) => [...svg.querySelectorAll(sel)].filter(atRest);

function toSvg(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector('svg');
}

function renderAll() {
    const out = {
        loading: MascotModule.loadingHtml(96),
        thinking: MascotModule.thinkingBubbleHtml(),
        'empty-diary': MascotModule.emptyHtml('diary', 'x'),
        'empty-calendar': MascotModule.emptyHtml('calendar', 'x'),
        'empty-generic': MascotModule.emptyHtml('generic', 'x'),
        welcome: MascotModule.welcomeHtml(),
        checkin: MascotModule.checkinHtml(),
    };
    for (const kind of ['happy', 'goodnight']) {
        MascotModule.showSaveEgg(kind);
        const egg = document.querySelector('.mascot-egg');
        out['egg-' + kind] = egg.innerHTML;
        egg.remove();
    }
    const svgs = {};
    for (const [name, html] of Object.entries(out)) svgs[name] = toSvg(html);
    return svgs;
}

describe('MascotModule rig（v2.6 motion Task 2）', () => {
    let svgs;
    beforeEach(() => {
        vi.useFakeTimers();   // showSaveEgg 的淡出計時器不外溢到別的測試
        loadScript('js/mascot.js');
        svgs = renderAll();
    });
    afterEach(() => { vi.useRealTimers(); });

    test.each(Object.keys(EXPECT))('%s：data-mm-pose 與唯一的 mm-rig 外層', (name) => {
        const svg = svgs[name];
        expect(svg.getAttribute('data-mm-pose')).toBe(EXPECT[name].pose);
        const rigs = svg.querySelectorAll('.mm-rig');
        expect(rigs.length).toBe(1);
        expect(rigs[0].parentNode).toBe(svg);
        // 所有圖元都在 mm-rig 裡（呼吸／彈跳才會帶著整隻動）
        restAll(svg, 'path,rect,circle,ellipse,text').forEach((el) => expect(rigs[0].contains(el)).toBe(true));
    });

    test.each(Object.keys(EXPECT))('%s：部件群組齊全、眼睛型別正確', (name) => {
        const svg = svgs[name];
        const e = EXPECT[name];
        expect(svg.querySelectorAll('.mm-body').length).toBe(1);
        expect(svg.querySelectorAll('.mm-bookmark').length).toBe(1);
        expect(svg.querySelectorAll(REST_FACE).length).toBe(1);
        const eyes = svg.querySelectorAll(`${REST_FACE} .mm-eyes`);
        expect(eyes.length).toBe(1);
        expect(eyes[0].getAttribute('data-mm-eyes')).toBe(e.eyes);
        expect(svg.querySelectorAll(`${REST_FACE} .mm-mouth`).length).toBe(1);
        expect(restAll(svg, '.mm-blush').length).toBe(e.blush);
        expect(svg.querySelectorAll('.mm-arm-r').length).toBe(e.armR);
    });

    test.each(Object.keys(EXPECT))('%s：mm-* 群組本身不帶 transform 屬性（CSS 動畫才蓋得上去）', (name) => {
        const groups = [...svgs[name].querySelectorAll('[class^="mm-"], [class*=" mm-"]')];
        expect(groups.length).toBeGreaterThanOrEqual(6);   // rig、body、bookmark、face、eyes、mouth 起跳
        const withTransform = groups.filter((el) => el.hasAttribute('transform'))
            .map((el) => el.getAttribute('class'));
        expect(withTransform).toEqual([]);
    });

    test.each(Object.keys(EXPECT))('%s：繪製順序 body → bookmark → face（臉畫在書皮之後才看得到）', (name) => {
        const svg = svgs[name];
        const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
        const body = svg.querySelector('.mm-body');
        const bookmark = svg.querySelector('.mm-bookmark');
        const faceEl = svg.querySelector(REST_FACE);
        expect(body.compareDocumentPosition(bookmark) & FOLLOWING).toBeTruthy();
        expect(bookmark.compareDocumentPosition(faceEl) & FOLLOWING).toBeTruthy();
    });

    test.each(Object.keys(EXPECT))('%s：圖元數與 rig 化之前相同（只包群組、不增刪筆畫）', (name) => {
        expect(restAll(svgs[name], 'path,rect,circle,ellipse,text').length).toBe(EXPECT[name].prims);
    });

    test('鎖定色票：書皮／書頁／書籤／描邊／眼口仍是契約 §1 的值', () => {
        const html = svgs.welcome.outerHTML;
        for (const color of ['#b98d6d', '#f9f3e6', '#5fd0a0', '#4b2e1e', '#2b1a10', '#f0a78f']) {
            expect(html).toContain(color);
        }
    });
});
