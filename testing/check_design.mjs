// The design checks from batch 9 in a headless browser: the nav at 390, errors under their field, the delete question,
// the History card on a phone, the sign in page, a disabled button in dark mode. Saves screenshots to the folder given.
// node check_design.mjs <folder for screenshots>, with the page on 4200 and the API on the address in environment.ts.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch();
const errors = [];
const notes = [];
async function ctx(width, dark = false) {
  const c = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await c.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:4200/login');
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD ?? 'Admin-pass-2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 });
  return { c, page };
}
const noScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
{
  const { c, page } = await ctx(390);
  await page.waitForSelector('table.industries tbody tr');
  const nav = await page.evaluate(() => [...document.querySelectorAll('.nav-links a')].map(a => ({ label: a.getAttribute('aria-label'), text: a.querySelector('span')?.textContent?.trim(), shown: getComputedStyle(a.querySelector('span')).display !== 'none', size: getComputedStyle(a.querySelector('span')).fontSize })));
  notes.push(`nav at 390: ${nav.length} items; labels ${nav.filter(n => n.shown).map(n => n.text + ' ' + n.size).join(', ')}; icon only: ${nav.filter(n => !n.shown).map(n => n.label).join(', ')}; no sideways scroll: ${await noScroll(page)}`);
  await page.screenshot({ path: `${out}/phone-nav.png`, clip: { x: 0, y: 0, width: 390, height: 120 } });
  const longName = 'A Very Long Company Name That Goes On LLC';
  await page.fill('input[formcontrolname="name"]', longName);
  await page.selectOption('select[formcontrolname="sector"]', 'Public Sector');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);
  await page.fill('input[placeholder="Search by name"]', 'A Very Long');
  await page.waitForTimeout(400);
  const row = page.locator('table.industries tbody tr').first();
  const cut = await row.locator('td.name').evaluate(td => td.scrollWidth > td.clientWidth && getComputedStyle(td).textOverflow === 'ellipsis');
  notes.push(`phone long name cut with ...: ${cut}, no sideways scroll: ${await noScroll(page)}`);
  await row.getByRole('button', { name: /^Delete / }).click();
  const del = row.locator('button.confirming');
  notes.push(`phone delete question: "${await row.locator('.confirm-text').evaluate(e => e.innerText.trim())}", button aria-label "${await del.getAttribute('aria-label')}"`);
  await page.screenshot({ path: `${out}/phone-delete.png` });
  await del.click();
  await page.waitForSelector('p.result.deleted');
  notes.push(`after delete: "${await page.locator('p.result.deleted').innerText()}"`);
  await page.goto('http://localhost:4200/history');
  await page.waitForSelector('table.versions tbody tr');
  notes.push(`history card rows cell: "${await page.locator('table.versions tbody tr').first().locator('td.num').innerText()}"`);
  notes.push(`retention unit display: ${(await page.evaluate(() => [...document.querySelectorAll('.settings-row .unit')].map(u => getComputedStyle(u).display))).join('/')} for values [${(await page.evaluate(() => [...document.querySelectorAll('.settings-row input')].map(i => i.value))).join('|')}]`);
  await page.locator('.settings-row').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/phone-history.png` });
  await page.focus('.nav-links a[aria-label="History"]');
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  notes.push(`focus ring on a nav link: ${await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth}`; })}`);
  await c.close();
}
{
  const { c, page } = await ctx(1280);
  await page.waitForSelector('table.industries tbody tr');
  await page.fill('input[formcontrolname="name"]', 'x'.repeat(60));
  await page.fill('input[formcontrolname="price"]', '99');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  notes.push(`desktop field problems: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.field-error.inline')].map(e => ({ id: e.id, text: e.textContent.trim(), describedBy: e.parentElement?.querySelector('input,select')?.getAttribute('aria-describedby') }))))}`);
  await page.locator('#add').screenshot({ path: `${out}/desktop-form-errors.png` });
  notes.push(`badge title: "${await page.locator('.db-status').first().getAttribute('title')}", search placeholder: "${await page.locator('input[type="search"]').getAttribute('placeholder')}"`);
  const row = page.locator('table.industries tbody tr').first();
  await row.getByRole('button', { name: /^Delete / }).click();
  notes.push(`desktop delete question: "${await row.locator('.confirm-text').evaluate(e => e.innerText.trim())}"`);
  await row.screenshot({ path: `${out}/desktop-delete.png` });
  await page.goto('http://localhost:4200/login');
  await page.waitForSelector('form');
  notes.push(`sign in page says "Sign in" ${await page.evaluate(() => (document.body.innerText.match(/Sign in/g) || []).length)} times, card title "${await page.locator('.card h2').innerText()}"`);
  await page.screenshot({ path: `${out}/desktop-login.png` });
  await c.close();
}
{
  const { c, page } = await ctx(1280, true);
  await page.waitForSelector('table.industries tbody tr');
  notes.push(`dark disabled Add button: ${JSON.stringify(await page.locator('button[type="submit"]').evaluate(b => ({ disabled: b.disabled, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor, opacity: getComputedStyle(b).opacity })))}`);
  await page.locator('#add').screenshot({ path: `${out}/dark-form.png` });
  await c.close();
}
for (const n of notes) console.log(n);
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
