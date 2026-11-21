// Signs in and looks at the five changes that jsdom cannot see. Opens the restore question but never confirms one.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
// fileURLToPath, not `new URL(...).pathname`: on Windows the pathname keeps a leading slash ("/C:/...")
// and path.resolve then makes "C:\C:\...". fileURLToPath gives the plain Windows path.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The host guard runs before anything else, so a wrong APP_URL fails before a folder is made or a password is read.
const app = process.env.APP_URL ?? 'http://localhost:4200';
const host = new URL(app).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`refusing to run against ${host}: this check is for localhost only`);

// Screenshots go beside the repo by default, never inside it, so a bare run leaves no untracked PNGs in the tree.
const out = process.argv[2] ?? path.join(repo, '..', 'dsh-shots', 'after');
fs.mkdirSync(out, { recursive: true });

const control = fs.readFileSync(path.join(repo, 'scripts', 'seeding.control.toml'), 'utf8');
// A missing or blank key has to fail here, by name. Returning '' would surface 20 seconds later as a sign-in timeout.
const field = (n) => {
  if (!new RegExp(`^\\s*${n}\\s*=`, 'm').test(control)) throw new Error(`scripts/seeding.control.toml has no "${n}" key, so there is nothing to sign in with`);
  const v = (control.match(new RegExp(`^\\s*${n}\\s*=\\s*"?([^"\\r\\n]*?)"?\\s*$`, 'm')) || [])[1] ?? '';
  if (!v.trim()) throw new Error(`scripts/seeding.control.toml has an empty "${n}" value, so there is nothing to sign in with`);
  return v;
};
const username = field('username').trim();
const password = field('password');

const fails = [];
const check = (label, ok) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`); if (!ok) fails.push(label); };
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

await page.goto(`${app}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('input:not([type=password])').first().fill(username);
await page.locator('input[type=password]').first().fill(password);
await page.locator('button[type=submit]').first().click();
await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });

// 1. Fields and History use the normal nav, and keep the theme button they had before they moved to it.
//    The theme button is checked at both widths because the crowded nav drops labels on a phone.
const sizes = [{ width: 1400, height: 1000, tag: '' }, { width: 390, height: 844, tag: '-phone' }];
for (const route of ['fields', 'history']) {
  for (const size of sizes) {
    const where = `${route}${size.tag}`;
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`${app}/${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const nav = page.locator('nav.nav');
    const adminNav = page.locator('nav.admin-nav');
    check(`/${where} uses the normal nav`, await nav.count() === 1 && await adminNav.count() === 0);
    check(`/${where} marks itself as the current page`, await page.locator(`nav.nav a[href="/${route}"].active`).count() > 0);
    // An admin on these pages has to be able to change the theme without leaving the page
    const theme = nav.locator('.theme-btn');
    check(`/${where} keeps the theme button`, await theme.count() === 1);
    check(`/${where} switches the theme from the nav`, await theme.getAttribute('aria-label') === 'Switch to dark mode');
    // The nav must still fit the width: eight items in one row is what the button risks
    check(`/${where} keeps the nav on screen`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await shot(page, where);
  }
}
await page.setViewportSize({ width: 1400, height: 1000 });

// 2. The restore question asks for a note, and glows
await page.goto(`${app}/history`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.locator('table.versions tbody tr').first().getByRole('button', { name: /Restore/ }).first().click();
await page.waitForTimeout(400);
const panel = page.locator('#version-panel');
check('the panel glows as it opens', await panel.evaluate((n) => n.classList.contains('glow')));
check('it asks for a note, not the word RESTORE', !(await panel.textContent()).includes('Type RESTORE'));
const restoreBtn = panel.getByRole('button', { name: /^Restore$/ }).first();
check('Restore is disabled with nothing written', await restoreBtn.isDisabled());
// The grey button has to say why it is grey, in words, on the page
check('the least length is written on the page, not only in the README', (await panel.textContent()).includes('at least 10 characters'));
await panel.locator('input').first().fill('nine char');
check('Restore is still disabled at 9 characters', await restoreBtn.isDisabled());
await panel.locator('input').first().fill('long enough to count');
check('Restore turns on at 10 characters or more', !(await restoreBtn.isDisabled()));
await shot(page, 'restore-note');

// Escape has to close the restore question, like every other overlay here. Asserted, not assumed: without this the
// run just navigates away and a panel that ignores Escape still reads green.
await page.keyboard.press('Escape');
await panel.waitFor({ state: 'detached', timeout: 5000 });
check('Escape closes the restore question', await panel.count() === 0);

// The same for the other question on this page, the one that asks for a typed RESTORE over a backup
const backupsCard = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Backups' }) });
await backupsCard.getByRole('button', { name: /^Restore$/ }).first().click();
await page.locator('#restore-backup').waitFor({ state: 'visible', timeout: 15000 });
await page.keyboard.press('Escape');
await page.locator('#restore-backup').waitFor({ state: 'detached', timeout: 5000 });
check('Escape closes the backup restore question too', await page.locator('#restore-backup').count() === 0);

// 3. The age line sits beside the saved copy
check('a saved copy says how old it is', /\d+ (hour|hours|day|days)|less than an hour/.test(await page.locator('table.versions tbody tr').first().textContent()));

// 4. The shortcuts panel dims less and blurs what is behind it
await page.goto(`${app}/overview`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.keyboard.press('?');
await page.waitForSelector('.panel.pop', { timeout: 15000 });
await page.waitForTimeout(600);
check('the page steps aside for it', await page.evaluate(() => document.documentElement.classList.contains('shortcuts-open')));
check('the backdrop blurs what is behind it', await page.locator('.backdrop').evaluate((n) => getComputedStyle(n).backdropFilter.includes('blur')));
// A band, not `> 0.8`: the untouched default is 1, so only the lower bound alone would pass with the whole rule deleted.
const dim = Number(await page.locator('.app').evaluate((n) => getComputedStyle(n).opacity));
check(`the page dims a little but stays readable (opacity ${dim})`, dim < 1 && dim > 0.8);
await shot(page, 'shortcuts-blur');

// 5. Closing the panel by its own path must clear the mark. The unit test drives the service directly, so it cannot catch this.
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('closing the panel clears the mark', !(await page.evaluate(() => document.documentElement.classList.contains('shortcuts-open'))));

// 6. The same, with the theme the other way round. The backdrop covers the page on purpose, so the panel has to be closed
//    before the theme button can be clicked at all - a real behaviour of this design, learned by trying it.
await page.locator('.theme-btn').click();
await page.waitForTimeout(800);
await page.keyboard.press('?');
await page.waitForSelector('.panel.pop', { timeout: 15000 });
await page.waitForTimeout(900);
check('the backdrop blurs in dark mode too', await page.locator('.backdrop').evaluate((n) => getComputedStyle(n).backdropFilter.includes('blur')));
await shot(page, 'shortcuts-blur-dark');

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
