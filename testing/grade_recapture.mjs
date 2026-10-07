import { chromium } from 'playwright';
import fs from 'node:fs';
if (!process.env.ADMIN_PASSWORD) { console.error('Set ADMIN_PASSWORD first, see testing/README.md'); process.exit(1); }
const out = process.argv[2];
const PW = process.env.ADMIN_PASSWORD;
const browser = await chromium.launch();
const facts = JSON.parse(fs.readFileSync(`${out}/facts.json`, 'utf8'));
facts.recapture ??= {};
const save = () => fs.writeFileSync(`${out}/facts.json`, JSON.stringify(facts, null, 2));
const outlineOf = p => p.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { tag: e.tagName, cls: e.className, label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineOffset: s.outlineOffset, outlineColor: s.outlineColor, boxShadow: s.boxShadow }; });
async function tabTo(page, test, max = 60) { for (let i = 0; i < max; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(test)) return true; } return false; }
function lum([r, g, b]) { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function ratio(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const parse = s => { const m = (s.match(/[\d.]+/g) || []).map(Number); return m.length >= 4 ? m.slice(0, 4) : [...m.slice(0, 3), 1]; };
const over = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3]));
async function open(width, dark = false) {
  const c = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await c.newPage();
  await page.goto('http://localhost:4200/login');
  await page.fill('input[autocomplete="username"]', 'admin'); await page.fill('input[type="password"]', PW); await page.keyboard.press('Enter');
  try { await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 }); }
  catch { throw new Error('sign in failed: ' + (await page.locator('.field-error').innerText().catch(() => '?'))); }
  return { c, page };
}
const token = await (await fetch('http://localhost:5005/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) })).json();
const rows = await (await fetch('http://localhost:5005/industries', { headers: { authorization: 'Bearer ' + token.token } })).json();
const amberName = rows.find(r => r.duplicateOf !== null)?.name;
facts.recapture.amberName = amberName;
for (const dark of [false, true]) {
  const { c, page } = await open(1280, dark); const scheme = dark ? 'dark' : 'light';
  await page.waitForSelector('table.industries tbody tr');
  await page.fill('input[type="search"]', amberName); await page.waitForTimeout(400);
  const amber = page.locator('table.industries tbody tr.similar').first();
  const reading = await amber.evaluate(tr => { const btn = tr.querySelector('button.remove-btn'); const name = tr.querySelector('td.name'); const flag = tr.querySelector('.flag'); return { rowBg: getComputedStyle(tr).backgroundColor, cardBg: getComputedStyle(tr.closest('.panel')).backgroundColor, deleteColor: getComputedStyle(btn).color, nameColor: getComputedStyle(name).color, flagColor: flag ? getComputedStyle(flag).color : null, flagTitle: flag?.getAttribute('title') }; });
  const rowOnCard = over(parse(reading.rowBg), parse(reading.cardBg));
  reading.ratios = { 'delete red on the rendered amber row': +ratio(parse(reading.deleteColor), rowOnCard).toFixed(2), 'name text on the rendered amber row': +ratio(parse(reading.nameColor), rowOnCard).toFixed(2) };
  facts.recapture[`amber_${scheme}`] = reading;
  await amber.screenshot({ path: `${out}/c9-${scheme}-amber-row.png` });
  await page.evaluate(() => document.body.focus());
  const got = await tabTo(page, () => document.activeElement.classList.contains('flag'));
  await page.waitForTimeout(250);
  facts.recapture[`flagFocus_${scheme}`] = got ? await outlineOf(page) : 'not reached';
  await amber.screenshot({ path: `${out}/c9-${scheme}-focus-flag.png` });
  save(); await c.close();
}
{
  const { c, page } = await open(1280);
  let slow = true;
  await page.route('**/backups', async route => { if (slow) await new Promise(r => setTimeout(r, 3000)); try { await route.continue(); } catch {} });
  await page.goto('http://localhost:4200/history');
  await page.waitForSelector('section.card:has(h2:has-text("Backups")) p.state');
  facts.recapture.loadingBackups = await page.locator('section.card:has(h2:has-text("Backups")) p.state').evaluate(p => ({ text: p.innerText.trim(), spinner: p.querySelector('i')?.className, spinnerAnimation: p.querySelector('i') ? getComputedStyle(p.querySelector('i')).animationName : null }));
  await page.locator('section.card:has(h2:has-text("Backups"))').screenshot({ path: `${out}/c9-loading-backups.png` });
  slow = false; save(); await c.close();
}
{
  const { c, page } = await open(1280);
  await page.waitForSelector('table.industries tbody tr');
  await page.locator('#add button[type="submit"]').click(); await page.waitForTimeout(300);
  facts.recapture.addFormEdges = await page.evaluate(() => ['name', 'sector'].map(k => { const b = document.querySelector(`#add [formcontrolname="${k}"]`); return { box: k, borderColor: getComputedStyle(b).borderColor, invalid: b.getAttribute('aria-invalid'), describedBy: b.getAttribute('aria-describedby') }; }));
  await page.locator('#add').screenshot({ path: `${out}/c9-form-errors.png` });
  await page.goto('http://localhost:4200/account'); await page.waitForSelector('form');
  const sent = []; page.on('request', r => { if (r.url().includes('/auth/password')) sent.push(r.url()); });
  facts.recapture.accountTries = [];
  for (const [n, r] of [['short1', 'short1'], ['a new password', 'a new passwor'], [PW, PW]]) {
    await page.fill('input[autocomplete="current-password"]', PW);
    await page.fill('input[autocomplete="new-password"] >> nth=0', n);
    await page.fill('input[autocomplete="new-password"] >> nth=1', r);
    await page.click('button[type="submit"]'); await page.waitForTimeout(300);
    const problem = await page.evaluate(() => { const e = document.querySelector('.field-error.inline'); if (!e) return null; const field = e.closest('.field'); const box = field.querySelector('input'); const fields = [...document.querySelectorAll('form .field')]; const next = fields[fields.indexOf(field) + 1]; return { id: e.id, text: e.textContent.trim(), boxLabel: field.querySelector('.field-label').innerText.trim(), boxDescribedBy: box.getAttribute('aria-describedby'), boxInvalid: box.getAttribute('aria-invalid'), underItsBox: box.getBoundingClientRect().bottom <= e.getBoundingClientRect().top + 1, aboveNextField: next ? e.getBoundingClientRect().bottom <= next.getBoundingClientRect().top + 1 : true }; });
    facts.recapture.accountTries.push({ next: n === PW ? '(same as current)' : n, problem, summaryLines: await page.evaluate(() => [...document.querySelectorAll('form > .field-error')].map(e => e.textContent.trim())), requestsSoFar: sent.length });
    await page.locator('section.card').screenshot({ path: `${out}/c9-account-try-${facts.recapture.accountTries.length}.png` });
  }
  save(); await c.close();
}
{
  const { c, page } = await open(390);
  await page.waitForSelector('table.industries tbody tr');
  facts.recapture.phoneCells = await page.evaluate(() => [...document.querySelectorAll('table.industries tbody tr')].slice(0, 1).flatMap(tr => [...tr.querySelectorAll('td:not(.actions)')].map(td => ({ text: td.innerText.trim(), textOverflow: getComputedStyle(td).textOverflow, cut: td.scrollWidth > td.clientWidth, right: Math.round(td.getBoundingClientRect().right), actionsLeft: Math.round(tr.querySelector('td.actions').getBoundingClientRect().left) }))));
  await page.locator('#browse .table-wrap').screenshot({ path: `${out}/c9-phone-cells.png` });
  save(); await c.close();
}
console.log(JSON.stringify(facts.recapture, null, 1));
await browser.close();
