import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const errors = [];
async function run(name, { width, height, dark }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto('http://localhost:4200/login');
  await page.fill('input[type="text"], input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD ?? 'Admin-pass-2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 });
  await page.goto('http://localhost:4200/history');
  await page.waitForSelector('section.card table.versions tbody tr', { timeout: 15000 });
  const restore = page.locator('section.card table.versions tbody tr').first().getByRole('button', { name: /^Restore/ });
  await restore.click();
  await page.waitForSelector('#restore-backup');
  await page.locator('#restore-backup').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-ask.png`, fullPage: false });
  const askText = await page.locator('#restore-backup p').first().innerText();
  if (name === 'desktop') {
    await page.fill('#restore-backup input', 'RESTORE');
    await page.locator('#restore-backup').getByRole('button', { name: /^Restore$/ }).click();
    await page.waitForSelector('p.result.small', { timeout: 60000 });
    await page.screenshot({ path: `${out}/${name}-done.png` });
    console.log('done text:', await page.locator('p.result.small').first().innerText());
  }
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  console.log(name, 'ask text:', askText.slice(0, 160).replace(/\n/g, ' '), '| no sideways scroll:', scrollW);
  await ctx.close();
}
await run('desktop', { width: 1280, height: 900, dark: false });
await run('phone', { width: 390, height: 844, dark: false });
await run('dark', { width: 1280, height: 900, dark: true });
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
