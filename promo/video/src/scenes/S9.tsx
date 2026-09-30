/**
 * S9 存在你的電腦，AI 由你選 — 68.0–80.0 s (frames 4080–4799). STORYBOARD §1.2 S9.
 * Motion graphics on cream paper, drawn in the outline brown #4b2e1e:
 *   68.0–71.2 a laptop draws itself; on its screen the app's mascot and a 「urdiary.db」 file;
 *             「你的電腦」, 「日記存在本機 SQLite 檔」, and from 70.5 「不用註冊雲端帳號・沒有追蹤」.
 *   71.2–75.0 a dashed line runs right to four text-only provider labels; one lights up as
 *             「你選的」 (Grok — the demo account's grok-4.3); dots travel back and forth.
 *             Fine print line 1 (71.2–80.0).
 *   75.0–80.0 the line retracts; a 「本地模型（Ollama／LM Studio）」 box grows inside the laptop
 *             and the dots circle inside it. Fine print line 2 (75.0–80.0).
 *   73.6–74.6 (optional, U16): under the chips, the real app's provider selector 「AI: Grok (xAI)」
 *             (native 2× crop, drawn 1:1 at 560×80), fading in and out.
 * No logos, no sound on the moving dots (§1.2 「避免科技感」).
 */
import {AbsoluteFill} from 'remotion';
import {caption} from '../data/captions.ts';
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {UI} from '../data/ui-strings.ts';
import {EASE_IN_OUT, EASE_OUT, lerp, presence, ramp} from '../lib/anim.ts';
import {C, FONT} from '../lib/theme.ts';
import {useTime} from '../lib/time.tsx';
import {CaptionText} from '../components/Caption.tsx';
import {Mascot} from '../components/Mascot.tsx';
import {MediaSlot, mediaFor} from '../components/MediaSlot.tsx';
import {Paper} from '../components/Paper.tsx';
import {idleRig} from './shared.tsx';

const SCREEN = {x: 170, y: 96, w: 580, h: 360};
const BASE_Y = SCREEN.y + SCREEN.h;
const LINE_Y = SCREEN.y + SCREEN.h * 0.5;
const LINE_X0 = SCREEN.x + SCREEN.w + 16;
const LINE_X1 = 1250;
const CHIP_X = 1280;
const CHIP_H = 72;
const CHIP_GAP = 20;
const PICKED = 'Grok';

const Appear = ({id, lang, x, y, role, center = false}: {id: string; lang: Lang; x: number; y: number; role: Parameters<typeof CaptionText>[0]['role']; center?: boolean}) => {
  const t = useTime();
  const c = caption(id);
  const o = presence(t, c.in, c.out, 0.45, 0.3);
  if (o <= 0) return null;
  const rise = lerp(10, 0, ramp(t, c.in, c.in + 0.55, EASE_OUT));
  return (
    <div
      style={{
        position: 'absolute',
        left: center ? 0 : x,
        right: center ? 0 : undefined,
        top: y,
        display: 'flex',
        justifyContent: center ? 'center' : 'flex-start',
        opacity: o,
        transform: `translateY(${rise}px)`,
      }}
    >
      <CaptionText role={role} lang={lang} text={c.text[lang]} style={center ? {textAlign: 'center'} : undefined} />
    </div>
  );
};

const Laptop = () => {
  const t = useTime();
  const draw = ramp(t, 68.0, 68.9, EASE_IN_OUT);
  const fill = ramp(t, 68.5, 69.0, EASE_OUT);
  const {x, y, w, h} = SCREEN;
  const outline = {fill: 'none', stroke: C.text, strokeWidth: 6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const, pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw};
  return (
    <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}} width={1920} height={1080}>
      <rect x={x} y={y} width={w} height={h} rx={24} fill={C.surface} opacity={fill} />
      <rect x={x + 18} y={y + 18} width={w - 36} height={h - 36} rx={12} fill="#fbf5ea" opacity={fill} />
      <rect x={x} y={y} width={w} height={h} rx={24} {...outline} />
      <path d={`M${x - 46} ${BASE_Y + 34} L${x + w + 46} ${BASE_Y + 34} L${x + w + 12} ${BASE_Y} L${x - 12} ${BASE_Y} Z`} fill={C.paperAlt} opacity={fill} />
      <path d={`M${x - 12} ${BASE_Y} L${x + w + 12} ${BASE_Y} L${x + w + 46} ${BASE_Y + 34} L${x - 46} ${BASE_Y + 34} Z`} {...outline} />
      <path d={`M${x + w / 2 - 60} ${BASE_Y + 1} q0 12 12 12 h96 q12 0 12 -12`} {...outline} strokeWidth={4} />
    </svg>
  );
};

const DbFile = () => {
  const t = useTime();
  const o = ramp(t, 68.8, 69.4, EASE_OUT);
  const x = SCREEN.x + 368;
  const y = SCREEN.y + 44;
  return (
    <div style={{position: 'absolute', left: x, top: y, opacity: o, transform: `translateY(${lerp(8, 0, o)}px)`}}>
      <svg width={120} height={146} viewBox="0 0 120 146" style={{display: 'block', margin: '0 auto'}}>
        <path d="M14 6 H78 L112 40 V132 Q112 140 104 140 H14 Q6 140 6 132 V14 Q6 6 14 6 Z" fill={C.surface} stroke={C.text} strokeWidth={5} strokeLinejoin="round" />
        <path d="M78 6 V32 Q78 40 86 40 H112" fill="#efe3cf" stroke={C.text} strokeWidth={5} strokeLinejoin="round" />
        <path d="M26 70 H92 M26 90 H92 M26 110 H70" stroke={C.cover} strokeWidth={6} strokeLinecap="round" />
      </svg>
      <div style={{marginTop: 8, textAlign: 'center', fontFamily: FONT.sans, fontWeight: 700, fontSize: 25, color: C.text}}>{UI.dbFile}</div>
    </div>
  );
};

const tri = (x: number) => 1 - Math.abs(((x % 2) + 2) % 2 - 1);

const Providers = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const c = caption('s9-providers');
  const names = c.text[lang].split(/\s*[・·]\s*/);
  const reach = ramp(t, 71.2, 71.8, EASE_IN_OUT) * (1 - ramp(t, 75.0, 75.5, EASE_IN_OUT));
  const chipsOut = 1 - ramp(t, 75.0, 75.4, EASE_IN_OUT);
  const lit = ramp(t, 72.3, 72.7, EASE_OUT);
  const total = names.length * CHIP_H + (names.length - 1) * CHIP_GAP;
  const top = LINE_Y - total / 2;
  const x1 = lerp(LINE_X0, LINE_X1, reach);
  const dotsOn = t >= 71.8 && t < 75.0;
  return (
    <>
      <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}} width={1920} height={1080}>
        {reach > 0 ? <path d={`M${LINE_X0} ${LINE_Y} H${x1}`} stroke={C.text} strokeWidth={4} strokeDasharray="14 12" strokeLinecap="round" /> : null}
        {reach > 0.98 ? <path d={`M${LINE_X1} ${top + CHIP_H / 2} V${top + total - CHIP_H / 2}`} stroke={C.text} strokeWidth={4} strokeLinecap="round" opacity={chipsOut} /> : null}
        {dotsOn
          ? [0, 0.66, 1.33].map((off) => {
              const k = tri((t - 71.8) / 1.5 + off);
              return <circle key={off} cx={lerp(LINE_X0 + 10, LINE_X1 - 10, k)} cy={LINE_Y} r={9} fill={C.bookmark} stroke={C.text} strokeWidth={3} />;
            })
          : null}
      </svg>
      {names.map((n, i) => {
        const o = ramp(t, 71.45 + i * 0.12, 71.85 + i * 0.12, EASE_OUT) * chipsOut;
        if (o <= 0) return null;
        const picked = n === PICKED;
        return (
          <div
            key={n}
            style={{
              position: 'absolute',
              left: CHIP_X,
              top: top + i * (CHIP_H + CHIP_GAP),
              height: CHIP_H,
              display: 'flex',
              alignItems: 'center',
              padding: '0 26px',
              borderRadius: 16,
              background: picked ? `rgba(95, 208, 160, ${0.18 + 0.3 * lit})` : C.surface,
              border: `2.5px solid ${picked ? (lit > 0.5 ? C.bookmarkInk : C.lineStrong) : C.lineStrong}`,
              boxShadow: picked && lit > 0 ? `0 0 0 ${6 * lit}px rgba(95, 208, 160, 0.25)` : C.shadowSoft,
              opacity: o,
              transform: `translateX(${lerp(-14, 0, o)}px)`,
            }}
          >
            <CaptionText role="diagram-chip" lang="en" text={n} style={{color: picked && lit > 0.5 ? C.bookmarkInk : C.text}} />
          </div>
        );
      })}
    </>
  );
};

const LocalModel = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const c = caption('s9-local');
  const k = ramp(t, c.in + 0.1, c.in + 0.7, EASE_OUT) * (1 - ramp(t, c.out - 0.3, c.out, EASE_IN_OUT));
  if (k <= 0) return null;
  const cx = SCREEN.x + SCREEN.w / 2;
  const orbit = t >= c.in + 0.6;
  return (
    <>
      {orbit ? (
        // under the box: the dots circle inside the laptop and pass behind the label
        <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}} width={1920} height={1080}>
          {[0, 1 / 3, 2 / 3].map((off) => {
            const a = ((t - c.in) / 3 + off) * Math.PI * 2;
            return <circle key={off} cx={cx + Math.cos(a) * 232} cy={SCREEN.y + 190 + Math.sin(a) * 118} r={8} fill={C.bookmark} stroke={C.text} strokeWidth={3} opacity={k} />;
          })}
        </svg>
      ) : null}
      <div style={{position: 'absolute', left: 0, width: SCREEN.x * 2 + SCREEN.w, top: SCREEN.y + SCREEN.h - 104, display: 'flex', justifyContent: 'center'}}>
        <div
          style={{
            padding: '10px 22px',
            borderRadius: 14,
            background: '#e2f5eb',
            border: `2.5px solid ${C.bookmarkInk}`,
            opacity: k,
            transform: `scale(${lerp(0.6, 1, k)})`,
          }}
        >
          <CaptionText role="diagram-chip" lang={lang} text={c.text[lang]} style={{color: C.bookmarkInk, whiteSpace: 'nowrap'}} />
        </div>
      </div>
    </>
  );
};

/** 底部細字: both lines in one centred column (line 1 wraps differently in zh / en), each on its own clock. */
const FinePrint = ({lang}: {lang: Lang}) => {
  const t = useTime();
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: 744, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6}}>
      {['s9-fine-1', 's9-fine-2'].map((id) => {
        const c = caption(id);
        const o = presence(t, c.in, c.out, 0.5, 0.3);
        return (
          <div key={id} style={{opacity: o, transform: `translateY(${lerp(8, 0, ramp(t, c.in, c.in + 0.6, EASE_OUT))}px)`}}>
            <CaptionText role="fine" lang={lang} text={c.text[lang]} style={{textAlign: 'center'}} />
          </div>
        );
      })}
    </div>
  );
};

export const S9 = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const u16Placement = introPlacement('S9.U16');
  const u16 = mediaFor(u16Placement, lang).entry;
  const u16Opacity = presence(t, u16Placement.at[0], u16Placement.at[1], 0.2, 0.2);
  const mascot = ramp(t, 68.6, 69.2, EASE_OUT);
  return (
    <AbsoluteFill>
      <Paper />
      <Laptop />
      <div style={{position: 'absolute', left: SCREEN.x + 70, top: SCREEN.y + 58, opacity: mascot, transform: `translateY(${lerp(10, 0, mascot)}px)`}}>
        <Mascot pose="smile" width={170} rig={idleRig(t, [70.2, 74.1, 77.6])} />
      </div>
      <DbFile />
      <LocalModel lang={lang} />
      <Providers lang={lang} />
      {u16 && u16Opacity > 0 ? (
        // under the provider chips, clear of the fine print (744 px down); only while the clip plays
        <div style={{position: 'absolute', left: CHIP_X, top: 486, width: 560, height: 80, borderRadius: 12, overflow: 'hidden', boxShadow: C.shadow, opacity: u16Opacity}}>
          <MediaSlot placement={introPlacement('S9.U16')} lang={lang} tone="ui" compact />
        </div>
      ) : null}
      <Appear id="s9-computer" lang={lang} x={SCREEN.x} y={BASE_Y + 56} role="diagram-title" />
      <Appear id="s9-sqlite" lang={lang} x={SCREEN.x} y={BASE_Y + 128} role="diagram-note" />
      <Appear id="s9-no-cloud" lang={lang} x={SCREEN.x} y={BASE_Y + 170} role="diagram-note" />
      <FinePrint lang={lang} />
    </AbsoluteFill>
  );
};
