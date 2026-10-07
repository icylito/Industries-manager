// Captures 1 to 7 of the rubric. node grade_capture.mjs <out folder> ; writes screenshots and facts.json
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2];
const setup = JSON.parse(fs.readFileSync('/var/tmp/apitest/grade.json', 'utf8'));
const PW = process.env.ADMIN_PASSWORD ?? 'Admin-pass-2026!';
const browser = await chromium.launch();
const START = +(process.env.START || 1);
const factsPath = `${out}/facts.json`;
const facts = fs.existsSync(factsPath) ? JSON.parse(fs.readFileSync(factsPath, 'utf8')) : {};
const save = () => fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2));
const shot = (page, name, opts = {}) => page.screenshot({ path: `${out}/${name}.png`, ...opts });
async function signIn(page) {
  await page.goto('http://localhost:4200/login');
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 });
}
async function ctx(width, dark = false) {
  const c = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await c.newPage();
  page.on('pageerror', e => (facts.pageErrors ??= []).push(e.message));
  return { c, page };
}
const outlineOf = p => p.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { tag: e.tagName, label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineOffset: s.outlineOffset, outlineColor: s.outlineColor, boxShadow: s.boxShadow }; });

// ---- capture 1 and 2: History at 1280, light
if (START <= 1) {
  const { c, page } = await ctx(1280);
  await signIn(page);
  let slow = true;
  await page.route('**/backups', async route => { if (slow) await new Promise(r => setTimeout(r, 2500)); try { await route.continue(); } catch {} });
  await page.goto('http://localhost:4200/history');
  await page.waitForSelector('section.card:has(h2:has-text("Backups"))');
  await page.locator('section.card:has(h2:has-text("Backups"))').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  facts.loadingBackupsText = await page.locator('section.card:has(h2:has-text("Backups")) p.state').innerText().catch(() => null);
  await page.locator('section.card:has(h2:has-text("Backups"))').screenshot({ path: `${out}/c1-loading-backups.png` });
  slow = false;
  await page.waitForSelector('table.versions tbody tr', { timeout: 20000 });
  await page.waitForSelector(`section.card:has(h2:has-text("Backups")) table tbody tr`);
  const backupsCard = page.locator('section.card:has(h2:has-text("Backups"))');
  facts.backupRows = await backupsCard.locator('table tbody tr').evaluateAll(rows => rows.map(r => ({ text: r.querySelector('td.what').innerText.replace(/\n/g, ' | '), restoreDisabled: [...r.querySelectorAll('button')].find(b => /Restore/.test(b.textContent)).disabled, restoreTitle: [...r.querySelectorAll('button')].find(b => /Restore/.test(b.textContent)).title })));
  await backupsCard.screenshot({ path: `${out}/c1-backups-list.png` });
  const setupRow = backupsCard.locator('table tbody tr').filter({ hasText: 'Manual' }).first();
  await setupRow.getByRole('button', { name: /^Restore/ }).click();
  await page.waitForSelector('#restore-backup');
  facts.restorePanelText = await page.locator('#restore-backup p').first().innerText();
  await page.fill('#restore-backup input', 'restore');
  facts.restoreButtonDisabledLower = await page.locator('#restore-backup').getByRole('button', { name: /^Restore$/ }).isDisabled();
  await page.locator('#restore-backup').scrollIntoViewIfNeeded();
  await shot(page, 'c1-restore-panel-lowercase');
  await page.fill('#restore-backup input', 'RESTORE');
  facts.restoreButtonDisabledUpper = await page.locator('#restore-backup').getByRole('button', { name: /^Restore$/ }).isDisabled();
  await shot(page, 'c1-restore-panel-uppercase');
  await page.locator('#restore-backup').getByRole('button', { name: /^Restore$/ }).click();
  await page.waitForSelector('section.card:has(h2:has-text("Backups")) p.result.small', { timeout: 60000 });
  facts.restoreResultText = await page.locator('section.card:has(h2:has-text("Backups")) p.result.small').innerText();
  await backupsCard.screenshot({ path: `${out}/c2-restore-result.png` });
  await page.waitForTimeout(800);
  facts.topVersionAfterRestore = await page.locator('section.panel table.versions tbody tr').first().innerText().then(t => t.replace(/\n/g, ' | '));
  await page.locator('section.panel').first().screenshot({ path: `${out}/c2-versions-top.png` });
  const ret = page.locator('section.card:has(h2:has-text("Keep old versions"))');
  await ret.locator('input').nth(0).fill('');
  await ret.locator('input').nth(1).fill('');
  await page.waitForTimeout(200);
  facts.retentionEmpty = await ret.evaluate(card => ({ inputs: [...card.querySelectorAll('input')].map(i => ({ value: i.value, placeholder: i.placeholder })), units: [...card.querySelectorAll('.unit')].map(u => ({ text: u.textContent, display: getComputedStyle(u).display })), text: card.innerText.replace(/\n/g, ' | ') }));
  await ret.screenshot({ path: `${out}/c2-retention-empty.png` });
  save();
  await c.close();
}

// ---- capture 3: main table at 1280, light
if (START <= 3) {
  const { c, page } = await ctx(1280);
  await signIn(page);
  await page.waitForSelector('table.industries tbody tr');
  await page.fill('input[type="search"]', 'Horizon Water');
  await page.waitForTimeout(400);
  const row = page.locator('table.industries tbody tr').first();
  await row.getByRole('button', { name: /^Delete / }).click();
  facts.desktopDeleteQuestion = await row.locator('.confirm-text').evaluate(e => e.innerText.trim());
  await row.screenshot({ path: `${out}/c3-delete-question.png` });
  await row.locator('button.confirming').click();
  await page.waitForSelector('p.result.deleted');
  facts.deletedLine = await page.locator('p.result.deleted').innerText();
  facts.deletedLineAboveTable = await page.evaluate(() => { const l = document.querySelector('p.result.deleted'); const t = document.querySelector('.table-wrap, p.state'); return !!(l && t && l.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING); });
  await page.locator('#browse').screenshot({ path: `${out}/c3-deleted-line.png` });
  await page.fill('input[type="search"]', '');
  await page.waitForTimeout(300);
  facts.toolbar = await page.evaluate(() => ({ searchPlaceholder: document.querySelector('input[type="search"]').placeholder, entriesText: document.querySelector('.entries').innerText.replace(/\s+/g, ' '), entriesTransform: getComputedStyle(document.querySelector('.entries')).textTransform, headers: [...document.querySelectorAll('.industries thead th .sort-btn')].map(b => ({ text: b.textContent.trim(), transform: getComputedStyle(b).textTransform })), badgeTitle: document.querySelector('.db-status').title, badgeText: document.querySelector('.db-status').innerText.trim() }));
  await page.locator('#browse .panel-head, #browse .toolbar').first().screenshot({ path: `${out}/c3-panel-head.png` });
  await page.locator('#browse .toolbar').screenshot({ path: `${out}/c3-toolbar.png` });
  await page.locator('#browse .table-wrap thead').screenshot({ path: `${out}/c3-headers.png` });
  // the empty form and Add
  await page.locator('#add').scrollIntoViewIfNeeded();
  await page.locator('#add button[type="submit"]').click();
  await page.waitForTimeout(300);
  facts.formProblems = await page.evaluate(() => [...document.querySelectorAll('#add .field-error.inline')].map(e => { const field = e.closest('.field'); const box = field.querySelector('input,select'); const next = field.nextElementSibling; return { id: e.id, text: e.textContent.trim(), boxDescribedBy: box?.getAttribute('aria-describedby'), boxInvalid: box?.getAttribute('aria-invalid'), underItsBox: box ? box.getBoundingClientRect().bottom <= e.getBoundingClientRect().top + 1 : null, aboveNextField: next ? e.getBoundingClientRect().bottom <= next.getBoundingClientRect().bottom : null }; }));
  facts.formSummaryLines = await page.evaluate(() => [...document.querySelectorAll('#add .form-problem')].map(e => e.textContent.trim()));
  await page.locator('#add').screenshot({ path: `${out}/c3-form-errors.png` });
  // focus ring: nav link, search box, a flag, a delete button
  await page.reload(); await page.waitForSelector('table.industries tbody tr');
  const focusFacts = [];
  await page.focus('.nav-links a[aria-label="History"]'); focusFacts.push(await outlineOf(page)); await page.locator('.nav').screenshot({ path: `${out}/c3-focus-navlink.png` });
  await page.focus('input[type="search"]'); focusFacts.push(await outlineOf(page)); await page.locator('#browse .toolbar').screenshot({ path: `${out}/c3-focus-search.png` });
  const flag = page.locator('.flag').first(); if (await flag.count()) { await flag.focus(); focusFacts.push(await outlineOf(page)); await flag.locator('..').screenshot({ path: `${out}/c3-focus-flag.png` }); }
  await page.locator('button.remove-btn').first().focus(); focusFacts.push(await outlineOf(page)); await page.locator('table.industries tbody tr').first().screenshot({ path: `${out}/c3-focus-delete.png` });
  await page.goto('http://localhost:4200/requests'); await page.waitForSelector('.tabs .tab');
  await page.locator('.tabs .tab').nth(1).focus(); focusFacts.push(await outlineOf(page)); await page.locator('.tabs').screenshot({ path: `${out}/c3-focus-tab.png` });
  facts.focusLight = focusFacts;
  save();
  await c.close();
}

// ---- capture 4: 390 light, admin
if (START <= 4) {
  const { c, page } = await ctx(390);
  await signIn(page);
  await page.waitForSelector('table.industries tbody tr');
  facts.phone = {};
  facts.phone.navItems = await page.evaluate(() => [...document.querySelectorAll('.nav-links a')].map(a => { const r = a.getBoundingClientRect(); const s = a.querySelector('span'); return { label: a.getAttribute('aria-label'), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), labelShown: s && getComputedStyle(s).display !== 'none', labelFontPx: s ? parseFloat(getComputedStyle(s).fontSize) : null, labelText: s?.textContent.trim() }; }));
  facts.phone.mainNoSidewaysScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.screenshot({ path: `${out}/c4-phone-nav.png`, clip: { x: 0, y: 0, width: 390, height: 110 } });
  await page.fill('input[formcontrolname="name"]', 'Another Long Company Name For The Phone Check LLC');
  await page.selectOption('select[formcontrolname="sector"]', 'Public Sector');
  await page.click('#add button[type="submit"]'); await page.waitForTimeout(1000);
  await page.fill('input[type="search"]', 'Another Long'); await page.waitForTimeout(400);
  const row = page.locator('table.industries tbody tr').first();
  facts.phone.longName = await row.evaluate(r => { const n = r.querySelector('td.name'); const a = r.querySelector('td.actions'); const s = getComputedStyle(n); return { textOverflow: s.textOverflow, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth, nameRight: Math.round(n.getBoundingClientRect().right), actionsLeft: Math.round(a.getBoundingClientRect().left), text: n.innerText.trim() }; });
  await page.locator('#browse .table-wrap').screenshot({ path: `${out}/c4-phone-long-name.png` });
  await row.getByRole('button', { name: /^Delete / }).click();
  facts.phone.deleteQuestion = await row.locator('.confirm-text').evaluate(e => e.innerText.trim());
  const del = row.locator('button.confirming');
  facts.phone.deleteButton = { ariaLabel: await del.getAttribute('aria-label'), title: await del.getAttribute('title') };
  await page.locator('#browse .table-wrap').screenshot({ path: `${out}/c4-phone-delete-for-good.png` });
  await del.click(); await page.waitForSelector('p.result.deleted');
  facts.phone.deletedLine = await page.locator('p.result.deleted').innerText();
  await page.goto('http://localhost:4200/history'); await page.waitForSelector('table.versions tbody tr');
  facts.phone.historyNoSidewaysScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  facts.phone.historyCards = await page.locator('section.panel table.versions tbody tr').evaluateAll(rows => rows.slice(0, 3).map(r => r.querySelector('td.num').innerText.trim()));
  await page.locator('section.panel table.versions tbody tr').first().screenshot({ path: `${out}/c4-phone-history-card.png` });
  save();
  await c.close();
}

// ---- capture 5: Fields delete, account page
if (START <= 5) {
  const { c, page } = await ctx(1280);
  await signIn(page);
  await page.goto('http://localhost:4200/fields'); await page.waitForSelector('.field-row');
  const ticker = page.locator('.field-row').filter({ hasText: 'Custom' }).first();
  await ticker.getByRole('button', { name: 'Delete' }).click();
  await page.locator('.field-row .ask').getByRole('button', { name: 'Delete' }).click();
  await page.waitForSelector('text=/Deleted .*rows in Industries/', { timeout: 20000 });
  facts.fieldDeletedText = await page.locator('text=/^Deleted .*/').first().innerText();
  await page.locator('section.panel').first().screenshot({ path: `${out}/c5-field-deleted.png` });
  await page.goto('http://localhost:4200/account'); await page.waitForSelector('form');
  const sent = []; page.on('request', r => { if (r.url().includes('/auth/password')) sent.push(r.url()); });
  const tries = [['short1', 'short1'], ['a new password', 'a new passwor'], [PW, PW]];
  facts.accountTries = [];
  for (const [n, r] of tries) {
    await page.fill('input[autocomplete="current-password"]', PW);
    await page.fill('input[autocomplete="new-password"] >> nth=0', n);
    await page.fill('input[autocomplete="new-password"] >> nth=1', r);
    await page.click('button[type="submit"]'); await page.waitForTimeout(300);
    facts.accountTries.push({ next: n === PW ? '(same as current)' : n, message: await page.locator('.field-error').first().innerText().catch(() => null), requestsSoFar: sent.length });
    await page.locator('section.card').screenshot({ path: `${out}/c5-account-try-${facts.accountTries.length}.png` });
  }
  save();
  await c.close();
}

// ---- capture 6: dark, contrast
function lum([r, g, b]) { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function ratio(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const parse = s => { const m = s.match(/[\d.]+/g).map(Number); return m.length >= 4 ? [m[0], m[1], m[2], m[3]] : [m[0], m[1], m[2], 1]; };
const over = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3]));
if (START <= 6) for (const dark of [false, true]) {
  const { c, page } = await ctx(1280, dark);
  await signIn(page);
  await page.waitForSelector('table.industries tbody tr');
  const colours = await page.evaluate(() => { const probe = document.createElement('span'); document.body.appendChild(probe); const get = v => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; }; const bgs = {}; for (const v of ['--bg', '--surface', '--muted', '--faint', '--danger', '--text', '--similar-bg', '--accent-text']) bgs[v] = get(v); probe.remove(); return bgs; });
  const bg = parse(colours['--bg']), surface = parse(colours['--surface']);
  const amber = over(parse(colours['--similar-bg']), bg);
  const pairs = { 'muted on bg': [parse(colours['--muted']), bg], 'muted on surface': [parse(colours['--muted']), surface], 'faint on bg': [parse(colours['--faint']), bg], 'faint on surface': [parse(colours['--faint']), surface], 'danger on bg': [parse(colours['--danger']), bg], 'danger on amber row': [parse(colours['--danger']), amber], 'text on amber row': [parse(colours['--text']), amber] };
  const amberRow = page.locator('table.industries tbody tr.similar').first();
  let amberBtn = null;
  if (await amberRow.count()) {
    amberBtn = await amberRow.locator('button.remove-btn').evaluate(b => ({ color: getComputedStyle(b).color, rowBg: getComputedStyle(b.closest('tr')).backgroundColor }));
    await amberRow.screenshot({ path: `${out}/c6-${dark ? 'dark' : 'light'}-amber-row.png` });
  }
  await page.goto('http://localhost:4200/history'); await page.waitForSelector('section.card:has(h2:has-text("Backups")) table tbody tr');
  await page.locator('section.card:has(h2:has-text("Backups")) table tbody tr').filter({ hasText: 'Manual' }).first().getByRole('button', { name: /^Restore/ }).click();
  await page.waitForSelector('#restore-backup');
  const disabled = await page.locator('#restore-backup').getByRole('button', { name: /^Restore$/ }).evaluate(b => ({ disabled: b.disabled, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor, opacity: getComputedStyle(b).opacity }));
  pairs['disabled button text on its fill'] = [parse(disabled.color), parse(disabled.bg)];
  await page.locator('#restore-backup').screenshot({ path: `${out}/c6-${dark ? 'dark' : 'light'}-disabled-button.png` });
  await page.focus('.nav-links a[aria-label="History"]');
  const navFocus = await outlineOf(page);
  await page.locator('.nav').screenshot({ path: `${out}/c6-${dark ? 'dark' : 'light'}-focus-navlink.png` });
  facts[dark ? 'dark' : 'light'] = { colours, disabledButton: disabled, amberDeleteButton: amberBtn, navFocus, ratios: Object.fromEntries(Object.entries(pairs).map(([k, [a, b]]) => [k, +ratio(a, b).toFixed(2)])) };
  await page.locator('#restore-backup').getByRole('button', { name: 'Cancel' }).click();
  save();
  await c.close();
}

// ---- capture 7: sign in card, back values, settings files, clipboard, guest
if (START <= 7) {
  const { c, page } = await ctx(1280);
  await page.goto('http://localhost:4200/login'); await page.waitForSelector('form');
  facts.signIn = await page.evaluate(() => ({ cardTitle: document.querySelector('.card h2').innerText.trim(), signInCount: (document.body.innerText.match(/Sign in/g) || []).length, cardLeft: Math.round(document.querySelector('.card').getBoundingClientRect().left), pageTitleLeft: Math.round(document.querySelector('h1').getBoundingClientRect().left) }));
  await shot(page, 'c7-sign-in');
  facts.backValues = [];
  for (const back of ['/history', '//evil.com', '/\\evil.com', 'https://evil.com', '%0d%0a']) {
    await page.goto('http://localhost:4200/login?back=' + encodeURIComponent(back).replace(/%250d%250a/, '%0d%0a'));
    await page.fill('input[autocomplete="username"]', 'admin'); await page.fill('input[type="password"]', PW); await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    facts.backValues.push({ back, landed: page.url() });
    await page.goto('http://localhost:4200/account'); await page.waitForSelector('form'); await page.getByRole('button', { name: 'Sign out' }).click(); await page.waitForTimeout(400);
  }
  await signIn(page);
  await page.goto('http://localhost:4200/history'); await page.waitForSelector('section.card:has(h2:has-text("Settings file"))');
  const sentSettings = []; page.on('request', r => { if (r.url().includes('/settings/import')) sentSettings.push(r.url()); });
  const files = [['big.json', Buffer.alloc(2 * 1024 * 1024, 32)], ['notjson.txt', Buffer.from('hello there')], ['list.json', Buffer.from('[]')], ['noapp.json', Buffer.from('{"retention":{"keepVersions":5}}')]];
  facts.settingsFiles = [];
  for (const [name, buffer] of files) {
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/json', buffer });
    await page.waitForTimeout(600);
    const card = page.locator('section.card:has(h2:has-text("Settings file"))');
    facts.settingsFiles.push({ name, message: await card.locator('.field-error').innerText().catch(() => null), requestsSoFar: sentSettings.length });
    await card.screenshot({ path: `${out}/c7-settings-${name.split('.')[0]}.png` });
  }
  await page.goto('http://localhost:4200/users'); await page.waitForSelector('table.people');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await page.fill('.add-person input', 'grader' + Date.now().toString().slice(-5)); await page.getByRole('button', { name: 'Add person' }).click();
  await page.waitForSelector('.password-line'); await page.getByRole('button', { name: 'Copy' }).click(); await page.waitForTimeout(200);
  facts.copyNote = await page.locator('.ask .hint-line').innerText().catch(() => null);
  await page.locator('.ask').screenshot({ path: `${out}/c7-copy-note.png` });
  await page.goto('http://localhost:4200/account'); await page.waitForSelector('form'); await page.getByRole('button', { name: 'Sign out' }).click();
  const guestCalls = []; page.on('request', r => { if (r.url().includes('/requests')) guestCalls.push(r.url()); });
  await page.goto('http://localhost:4200/'); await page.waitForSelector('table.industries tbody tr'); await page.waitForTimeout(1500);
  facts.guest = await page.evaluate(() => ({ hasForm: !!document.querySelector('#add form'), hasActionsHeader: !!document.querySelector('th.actions-col'), hasActionsCell: !!document.querySelector('td.actions'), guestNote: document.querySelector('#add')?.innerText.trim() }));
  facts.guest.requestsCalls = guestCalls.length;
  await shot(page, 'c7-guest-table');
  save();
  await c.close();
}
save();
console.log('captures written');
await browser.close();
