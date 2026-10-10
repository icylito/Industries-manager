// Builds src/icons.css: Font Awesome Free (npm, @fortawesome/fontawesome-free) as a plain font, with only the icons
// the app uses. Icons are drawn by CSS, so nothing watches the page: the hosted kit's script swapped every
// <i class="fa-..."> for an SVG as the page changed, and froze the page on a long list (docs/2026-10-10-icons.md).
//
//   node scripts/icons.mjs           writes src/icons.css from the icon names found in src/
//   node scripts/icons.mjs --check   exits 1 when an icon used in src/ is missing from src/icons.css
//
// Run it after using an icon the app hasn't used before. The fonts stay in node_modules: the build copies the two
// woff2 files it needs next to the page and loads them only when an icon shows.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fa = join(root, 'node_modules', '@fortawesome', 'fontawesome-free');
const out = join(root, 'src', 'icons.css');
// From src/icons.css to the package, for the font files
const fonts = '../node_modules/@fortawesome/fontawesome-free/webfonts/';

// Every fa-name in the templates and code
function usedNames() {
  const names = new Set();
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts')) {
        for (const m of readFileSync(path, 'utf8').matchAll(/\bfa-[a-z0-9-]+/g)) names.add(m[0]);
      }
    }
  };
  walk(join(root, 'src', 'app'));
  return names;
}

// The stylesheet's rules, one block each. @keyframes blocks hold nested braces, so depth is counted.
function blocks(css) {
  const list = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      list.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return list;
}

// An icon is a block that only names its glyph: .fa-xmark { --fa: "\f00d"; }
const iconOf = block => block.match(/^\.(fa-[a-z0-9-]+)\s*\{\s*--fa:\s*"[^"]*";\s*\}$/)?.[1] ?? null;

const css = readFileSync(join(fa, 'css', 'fontawesome.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const all = blocks(css);
const available = new Set(all.map(iconOf).filter(Boolean));
const used = usedNames();
const icons = [...used].filter(name => available.has(name)).sort();

if (process.argv.includes('--check')) {
  const have = new Set(blocks(readFileSync(out, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).map(iconOf).filter(Boolean));
  const missing = icons.filter(name => !have.has(name));
  if (missing.length) {
    console.error(`src/icons.css is missing ${missing.join(', ')}. Run: node scripts/icons.mjs`);
    process.exit(1);
  }
  console.log(`icons ok: ${icons.length} used, all in src/icons.css`);
  process.exit(0);
}

const version = JSON.parse(readFileSync(join(fa, 'package.json'), 'utf8')).version;
// The two font faces the app uses, solid and regular, woff2 only (every browser the page supports reads it)
const face = (file, weight) => `@font-face {
  font-family: 'Font Awesome 6 Free';
  font-style: normal;
  font-weight: ${weight};
  font-display: block;
  src: url("${fonts}${file}") format("woff2"); }`;

const text = `/*!
 * Font Awesome Free ${version} by @fontawesome - https://fontawesome.com
 * License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)
 * Copyright 2024 Fonticons, Inc.
 *
 * Made by scripts/icons.mjs with only the ${icons.length} icons the app uses. Don't edit by hand: run the script.
 */
:root, :host {
  --fa-style-family-classic: 'Font Awesome 6 Free';
  --fa-font-solid: normal 900 1em/1 'Font Awesome 6 Free';
  --fa-font-regular: normal 400 1em/1 'Font Awesome 6 Free'; }
${face('fa-solid-900.woff2', 900)}
${face('fa-regular-400.woff2', 400)}
.fas,
.fa-solid {
  font-weight: 900; }
.far,
.fa-regular {
  font-weight: 400; }
${all.filter(block => !iconOf(block)).join('\n')}
${all.filter(block => icons.includes(iconOf(block))).join('\n')}
`;
writeFileSync(out, text);
console.log(`src/icons.css: ${icons.length} icons, ${(text.length / 1024).toFixed(1)} KB`);
const unknown = [...used].filter(name => !available.has(name) && !all.some(b => b.includes('.' + name + ' ') || b.includes('.' + name + ',') || b.includes('.' + name + '{')));
if (unknown.length) console.log('not icons or helpers, check these: ' + unknown.join(', '));
