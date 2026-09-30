#!/usr/bin/env node
/**
 * Regenerates src/generated/mascot.ts (gitignored) from the app's single source of truth:
 *   desktop/js/mascot.js   — every pose / stamp SVG, taken through its PUBLIC API
 *   desktop/css/mascot.css — the motion the video reuses (sway, wave, blink, breathe) and the
 *                            rig pivots (transform-box / transform-origin)
 * Nothing is copied into git. The video therefore always shows the same mascot as the app.
 *
 *   node scripts/gen-mascot.mjs          write src/generated/mascot.ts
 *
 * mascot.js is a browser IIFE. It runs here in a node:vm sandbox; the egg overlays
 * (showSaveEgg / showNamingEgg) need a DOM, so the sandbox gets a tiny fake `document` that just
 * records what the module would have appended. Anything unexpected throws: a failed extraction
 * must stop the build, not ship a half-drawn mascot.
 */
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');
const REPO = resolve(PROJECT, '..', '..');
const JS = resolve(REPO, 'desktop/js/mascot.js');
const CSS = resolve(REPO, 'desktop/css/mascot.css');
const OUT = resolve(PROJECT, 'src/generated/mascot.ts');

const fail = (msg) => {
  console.error(`gen-mascot: ${msg}`);
  process.exit(1);
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const jsSrc = readFileSync(JS, 'utf8');
const cssSrc = readFileSync(CSS, 'utf8');

// ---------------------------------------------------------------- run mascot.js in a sandbox
const appended = [];
const fakeElement = (tag) => ({
  tag,
  className: '',
  innerHTML: '',
  textContent: '',
  children: [],
  classList: {add() {}, remove() {}},
  setAttribute() {},
  appendChild(child) {
    this.children.push(child);
    return child;
  },
  remove() {},
});
const sandbox = {
  console,
  setTimeout: () => 0,
  document: {
    querySelectorAll: () => [],
    createElement: fakeElement,
    body: {
      appendChild(child) {
        appended.push(child);
        return child;
      },
    },
  },
};
vm.createContext(sandbox);
vm.runInContext(`${jsSrc}\n;globalThis.__MM = MascotModule;`, sandbox, {filename: 'desktop/js/mascot.js'});
const MM = sandbox.__MM;
if (!MM) fail('desktop/js/mascot.js did not define MascotModule');

const svgOf = (html, where) => {
  const m = String(html).match(/<svg\b[\s\S]*<\/svg>/);
  if (!m) fail(`no <svg> in the output of ${where}`);
  return m[0];
};
// The root <svg> carries app-only sizing and behaviour hooks (data-mm-idle / tap / follow are
// read by mascot_motion.js). The video sizes the SVG itself and drives motion from the frame
// number, so strip them; everything inside the SVG is left byte-for-byte as the app draws it.
const normalizeRoot = (svg) =>
  svg.replace(/^<svg\b[^>]*>/, (open) =>
    open
      .replace(/\s(width|height)="[^"]*"/g, '')
      .replace(/\s(data-mm-idle|data-mm-tap|data-mm-follow)(="[^"]*")?/g, '')
      .replace(/\sclass=""/g, ''),
  );

const lastOverlay = (fn, where) => {
  appended.length = 0;
  fn();
  if (appended.length !== 1) fail(`${where} appended ${appended.length} overlays (expected 1)`);
  return svgOf(appended[0].innerHTML, where);
};

const poses = {
  smile: svgOf(MM.loadingHtml(200), 'loadingHtml'),
  wave: svgOf(MM.welcomeHtml(), 'welcomeHtml'),
  tea: svgOf(MM.checkinHtml(), 'checkinHtml'),
  sleep: svgOf(MM.emptyHtml('diary', ''), "emptyHtml('diary')"),
  calendar: svgOf(MM.emptyHtml('calendar', ''), "emptyHtml('calendar')"),
  question: svgOf(MM.emptyHtml('other', ''), "emptyHtml('other')"),
  jump: lastOverlay(() => MM.showSaveEgg('happy'), "showSaveEgg('happy')"),
  goodnight: lastOverlay(() => MM.showSaveEgg('goodnight'), "showSaveEgg('goodnight')"),
  cheer: lastOverlay(() => MM.showNamingEgg('x'), 'showNamingEgg'),
};
for (const [name, svg] of Object.entries(poses)) {
  const pose = svg.match(/data-mm-pose="([^"]+)"/)?.[1];
  if (pose !== name) fail(`pose "${name}" came back as data-mm-pose="${pose}"`);
  if (!/viewBox="0 0 2[02]0 200"/.test(svg)) fail(`pose "${name}" has an unexpected viewBox`);
  if (!svg.includes('class="mm-rig"')) fail(`pose "${name}" has no mm-rig group`);
  poses[name] = normalizeRoot(svg);
}

// Stamp ids are the keys of the (private) STAMP_ICONS table; each one is then drawn through the
// public stampIcon(). stampIcon falls back to "star" for unknown ids, so a parsing slip shows up
// as a duplicate of the star and is caught below.
const block = jsSrc.match(/const STAMP_ICONS = \{([\s\S]*?)\n\s*\};/);
if (!block) fail('could not find STAMP_ICONS in mascot.js');
const stampIds = [...block[1].matchAll(/^\s{8}([a-z]+):\s*`/gm)].map((m) => m[1]);
if (stampIds.length < 20) fail(`only ${stampIds.length} stamp ids parsed`);
const star = MM.stampIcon('star', 48);
const stamps = {};
for (const id of stampIds) {
  const svg = svgOf(MM.stampIcon(id, 48), `stampIcon('${id}')`);
  if (id !== 'star' && svg === star) fail(`stamp "${id}" fell back to the star — parser drift?`);
  stamps[id] = normalizeRoot(svg).replace(/\sclass="mascot-stamp"/, '');
}

// ---------------------------------------------------------------- motion from mascot.css
// A deliberately small parser: mascot.css only uses @keyframes with percentage / from / to
// selectors and transform functions with numeric arguments. If that ever changes the lookups
// below fail loudly instead of guessing.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(cssSrc);

const parseKeyframes = (name) => {
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start < 0) fail(`@keyframes ${name} not found in mascot.css`);
  let depth = 0;
  let i = css.indexOf('{', start);
  const bodyStart = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) break;
  }
  const body = css.slice(bodyStart, i);
  const frames = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const offsets = m[1].split(',').map((s) => {
      const t = s.trim();
      if (t === 'from') return 0;
      if (t === 'to') return 1;
      if (!/^[\d.]+%$/.test(t)) fail(`@keyframes ${name}: unsupported selector "${t}"`);
      return parseFloat(t) / 100;
    });
    const decls = {};
    for (const d of m[2].split(';')) {
      const [prop, ...rest] = d.split(':');
      if (!prop || !rest.length) continue;
      const p = prop.trim();
      const v = rest.join(':').trim();
      if (p === 'opacity') decls.opacity = parseFloat(v);
      else if (p === 'transform') {
        decls.transform = [...v.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)].map((f) => ({
          fn: f[1],
          args: f[2].split(',').map((a) => {
            const m = a.trim().match(/^(-?[\d.]+)([a-z%]*)$/);
            if (!m) fail(`@keyframes ${name}: cannot read transform argument "${a}"`);
            return {v: parseFloat(m[1]), unit: m[2]};
          }),
        }));
      }
    }
    for (const offset of offsets) frames.push({offset, ...decls});
  }
  frames.sort((a, b) => a.offset - b.offset);
  if (frames.length < 2) fail(`@keyframes ${name}: too few keyframes`);
  return frames;
};

// Top-level style rules only: @keyframes and @media blocks are cut out first (the reduced-motion
// block would otherwise "win"), then every `selector-list { body }` is indexed.
const withoutAtBlocks = (() => {
  let s = css;
  for (;;) {
    const at = s.search(/@(keyframes|media)\b/);
    if (at < 0) return s;
    let i = s.indexOf('{', at);
    let depth = 0;
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}' && --depth === 0) break;
    }
    s = s.slice(0, at) + s.slice(i + 1);
  }
})();
const RULES = [...withoutAtBlocks.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' ')),
  body: m[2],
}));
// Declarations for one exact selector, in source order (the last one wins, like the cascade
// between rules of equal specificity).
const declsOf = (selector, prop) => {
  const hits = RULES.filter((r) => r.selectors.includes(selector))
    .map((r) => r.body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`)))
    .filter(Boolean)
    .map((m) => m[1].trim());
  if (!hits.length) fail(`no "${prop}" for "${selector}" in mascot.css`);
  return hits;
};
const declOf = (selector, prop) => declsOf(selector, prop).at(-1);
// `animation: <name> <duration> [timing] …` (duration may be `var(--x, 3.6s)`).
const animationOf = (selector, name) => {
  const v = declsOf(selector, 'animation').find((a) => a.startsWith(`${name} `));
  if (!v) fail(`no "animation: ${name} …" for "${selector}"`);
  const m = v.match(new RegExp(`^${name}\\s+(?:var\\(--[\\w-]+,\\s*)?([\\d.]+)(ms|s)\\)?\\s*([a-z-]+)?`));
  if (!m) fail(`cannot read the duration of "${v}"`);
  const durationSec = parseFloat(m[1]) / (m[2] === 'ms' ? 1000 : 1);
  const timing = m[3] && m[3] !== 'infinite' ? m[3] : 'ease';
  return {durationSec, timing};
};

const motion = {
  sway: {...animationOf('.mascot-sway', 'mascot-sway'), origin: declOf('.mascot-sway', 'transform-origin'), keyframes: parseKeyframes('mascot-sway')},
  wave: {...animationOf('svg[data-mm-pose="wave"] .mm-arm-r', 'mm-wave'), keyframes: parseKeyframes('mm-wave')},
  blink: {...animationOf('svg.mm-blink .mm-eyes[data-mm-eyes="dot"]', 'mm-blink'), keyframes: parseKeyframes('mm-blink')},
  breathe: {...animationOf('svg[data-mm-idle] .mm-rig', 'mm-breathe'), keyframes: parseKeyframes('mm-breathe')},
  dots: {...animationOf('.mascot-dots span', 'mascot-dot'), keyframes: parseKeyframes('mascot-dot')},
};
// Rig pivots, exactly as the app sets them (fill-box = the part's own bounding box).
const pivots = {
  rig: declOf('.mm-rig', 'transform-origin'),
  eyes: declOf('.mm-eyes', 'transform-origin'),
  armR: declOf('.mm-arm-r', 'transform-origin'),
  armL: declOf('.mm-arm-l', 'transform-origin'),
};
for (const [k, v] of Object.entries(pivots)) if (!/^[\d.]+% [\d.]+%$/.test(v)) fail(`pivot ${k} = "${v}" is not "x% y%"`);

// ---------------------------------------------------------------- write
const rel = (p) => relative(REPO, p).split('\\').join('/');
const out = `// GENERATED by scripts/gen-mascot.mjs — do not edit, do not commit (gitignored).
// Source of truth: ${rel(JS)} (sha256 ${sha256(jsSrc).slice(0, 16)}…) and ${rel(CSS)} (sha256 ${sha256(cssSrc).slice(0, 16)}…).
// Poses come from the public MascotModule API; motion and pivots are parsed from mascot.css.

export const MASCOT_SOURCES = ${JSON.stringify({js: rel(JS), css: rel(CSS), jsSha256: sha256(jsSrc), cssSha256: sha256(cssSrc)}, null, 2)} as const;

export const POSES = ${JSON.stringify(poses, null, 2)} as const;
export type PoseId = keyof typeof POSES;

export const STAMPS = ${JSON.stringify(stamps, null, 2)} as const;
export type StampId = keyof typeof STAMPS;

export type TransformFn = {fn: string; args: Array<{v: number; unit: string}>};
export type Keyframe = {offset: number; opacity?: number; transform?: TransformFn[]};
export type CssAnimation = {durationSec: number; timing: string; origin?: string; keyframes: Keyframe[]};

export const MOTION: Record<'sway' | 'wave' | 'blink' | 'breathe' | 'dots', CssAnimation> = ${JSON.stringify(motion, null, 2)};

export const PIVOTS = ${JSON.stringify(pivots, null, 2)} as const;
`;
mkdirSync(dirname(OUT), {recursive: true});
writeFileSync(OUT, out);
console.log(
  `gen-mascot: ${Object.keys(poses).length} poses, ${stampIds.length} stamps, ${Object.keys(motion).length} animations -> ${relative(PROJECT, OUT)}`,
);
