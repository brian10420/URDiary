// @vitest-environment jsdom
/** MascotModule.stampIcon：24 款印章、fallback、尺寸 (v2.5 Spec A)。 */
import { describe, test, expect, beforeEach } from 'vitest';
import { loadScript } from './helpers/load.js';

const STAMP_IDS = ['cake','gift','heart','cheers','trophy','flag','book','star',
    'plane','camera','ball','movie','music','food','coffee','flower',
    'sun','umbrella','moon','rainbow','sprout','heal','paw','gradcap'];

describe('MascotModule.stampIcon', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    test('24 款都渲染出 svg 且帶 mascot-stamp class', () => {
        for (const id of STAMP_IDS) {
            const html = MascotModule.stampIcon(id, 40);
            expect(html).toContain('<svg');
            expect(html).toContain('mascot-stamp');
            expect(html).toContain('viewBox="0 0 48 48"');
        }
    });

    test('尺寸直通 width/height', () => {
        expect(MascotModule.stampIcon('cake', 14)).toContain('width="14"');
        expect(MascotModule.stampIcon('cake', 40)).toContain('height="40"');
    });

    test('未知 id 與原型鏈鍵 fallback star', () => {
        expect(MascotModule.stampIcon('nonsense', 14)).toBe(MascotModule.stampIcon('star', 14));
        expect(MascotModule.stampIcon('constructor', 14)).toBe(MascotModule.stampIcon('star', 14));
    });

    test('吉祥物系列含書本體、低落組全數存在', () => {
        for (const id of ['heart','book','umbrella','moon','heal']) {
            expect(MascotModule.stampIcon(id, 40)).toContain('#b98d6d'); // 書皮＝吉祥物本體
        }
    });
});
