// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 5：待機生命感的「誰會動」契約。
 * 契約 §4：聊天區域只有安靜搖擺／靜態吉祥物——思考中、生成日記、check-in 端茶
 * 一律不帶 data-mm-idle（不呼吸、不眨眼），即使端茶那隻是睜眼的。
 */
function svgOf(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector('svg');
}

describe('模板行為旗標', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    it.each([
        ['welcome', () => MascotModule.welcomeHtml()],
        ['empty-diary', () => MascotModule.emptyHtml('diary', 'x')],
        ['empty-calendar', () => MascotModule.emptyHtml('calendar', 'x')],
        ['empty-generic', () => MascotModule.emptyHtml('generic', 'x')],
    ])('%s 帶 data-mm-idle', (name, render) => {
        expect(svgOf(render()).hasAttribute('data-mm-idle')).toBe(true);
    });

    it.each([
        ['loading', () => MascotModule.loadingHtml(96)],
        ['thinking', () => MascotModule.thinkingBubbleHtml()],
        ['checkin', () => MascotModule.checkinHtml()],
    ])('聊天區域的 %s 不帶任何 data-mm-* 行為旗標', (name, render) => {
        const svg = svgOf(render());
        const flags = [...svg.attributes].map((a) => a.name).filter((n) => n.startsWith('data-mm-') && n !== 'data-mm-pose');
        expect(flags).toEqual([]);
    });
});

describe('排程器 × 真模板（jsdom）', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        Element.prototype.checkVisibility = function () { return true; };
        loadScript('js/mascot.js');
        loadScript('js/mascot_motion.js');
        document.body.innerHTML =
            `<div id="cal">${MascotModule.emptyHtml('calendar', 'x')}</div>` +
            `<div id="diary">${MascotModule.emptyHtml('diary', 'x')}</div>` +
            `<div class="chat-messages"><div id="tea">${MascotModule.checkinHtml()}</div></div>`;
        MascotMotion.init();
    });
    afterEach(() => {
        MascotMotion._test.teardown();
        delete Element.prototype.checkVisibility;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('3 秒一輪：空行事曆（睜眼）眨、空日記（睡著）不眨、聊天區 check-in 端茶（睜眼但非待機）不眨', () => {
        vi.advanceTimersByTime(3000);
        expect(document.querySelector('#cal svg').classList.contains('mm-blink')).toBe(true);
        expect(document.querySelector('#diary svg').classList.contains('mm-blink')).toBe(false);
        expect(document.querySelector('#tea svg').classList.contains('mm-blink')).toBe(false);
    });

    it('執行期排除：就算 idle 旗標的吉祥物被放進聊天訊息區或彩蛋浮層，也不眨眼', () => {
        const inChat = document.querySelector('.chat-messages');
        inChat.insertAdjacentHTML('beforeend', `<div id="flagged">${MascotModule.emptyHtml('calendar', 'x')}</div>`);
        document.body.insertAdjacentHTML('beforeend',
            `<div class="mascot-egg"><div id="flagged-egg">${MascotModule.emptyHtml('calendar', 'x')}</div></div>`);
        expect(document.querySelector('#flagged svg').hasAttribute('data-mm-idle')).toBe(true);
        vi.advanceTimersByTime(3000);
        expect(document.querySelector('#cal svg').classList.contains('mm-blink')).toBe(true);   // 對照：正常的仍眨
        expect(document.querySelector('#flagged svg').classList.contains('mm-blink')).toBe(false);
        expect(document.querySelector('#flagged-egg svg').classList.contains('mm-blink')).toBe(false);
    });
});
