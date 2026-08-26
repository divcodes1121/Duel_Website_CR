import { chromium } from 'playwright';

/* Item 7, tested the only way that means anything: two separate browser
   contexts are two separate localStorage stores, so each gets its own
   `dekkies-device-id` -- which is exactly the situation the rule exists for. */
const SITE = 'https://deckkies.com/';

const pass = [];
const fail = [];
const ok = (c, m) => {
  (c ? pass : fail).push(m);
  console.log((c ? '  + ' : '  - ') + m);
};

const browser = await chromium.launch();
const email = `dekkies.dev.${Date.now()}@gmail.com`;
const password = 'A-strong-passw0rd!';

async function newDesktop() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  return { ctx, page: await ctx.newPage() };
}

async function signIn(page, create) {
  await page.goto(SITE + '#/signin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  if (create) await page.locator('[role="tab"]', { hasText: 'Create account' }).click();
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(6500);
  /* First run lands on onboarding; walk it. */
  if ((await page.locator('[class*="_pip_"]').count()) === 3) {
    for (let i = 0; i < 3; i++) {
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(1200);
    }
  }
  await page.waitForSelector('button[aria-label="Profile menu"]', { timeout: 30000 });
}

// --- first desktop ----------------------------------------------------------
const a = await newDesktop();
await signIn(a.page, true);
ok(true, 'desktop A signed in');

const deviceA = await a.page.evaluate(() => localStorage.getItem('dekkies-device-id'));
ok(!!deviceA, `desktop A has its own device id (${String(deviceA).slice(0, 8)}…)`);

// --- second desktop, same account ------------------------------------------
const b = await newDesktop();
await signIn(b.page, false);
ok(true, 'desktop B signed in with the same account');

const deviceB = await b.page.evaluate(() => localStorage.getItem('dekkies-device-id'));
ok(deviceA !== deviceB, 'the two browsers really are different devices');

// --- A should now lose its slot on its next heartbeat -----------------------
/* Focus is what triggers the immediate check, which is the realistic case:
   someone comes back to the tab and finds they have been signed out. */
await a.page.bringToFront();
await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
await a.page.waitForTimeout(6000);

const aAfter = await a.page.evaluate(() => ({
  signIn: document.querySelectorAll('a[href="#/signin"]').length,
  profile: document.querySelectorAll('button[aria-label="Profile menu"]').length,
  session: Object.keys(localStorage).filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    .length,
  evictedNote: document.body.innerText.includes('signed in on another'),
}));
ok(aAfter.profile === 0, 'desktop A was signed out by the second login');
ok(aAfter.session === 0, `desktop A's session was cleared (${aAfter.session} keys)`);
ok(aAfter.evictedNote, 'desktop A is TOLD why, rather than silently demoted');

// --- and B is still working -------------------------------------------------
await b.page.bringToFront();
await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
await b.page.waitForTimeout(4000);
const bAfter = await b.page.evaluate(() => ({
  profile: document.querySelectorAll('button[aria-label="Profile menu"]').length,
}));
ok(bAfter.profile === 1, 'desktop B — the newer login — keeps working');

// --- a phone is a SEPARATE slot, not a third desktop ------------------------
const mobile = await browser.newContext({
  viewport: { width: 412, height: 900 },
  hasTouch: true,
  isMobile: true,
});
const mp = await mobile.newPage();
await signIn(mp, false);
await mp.waitForTimeout(3000);
const mobileOk = await mp.evaluate(
  () => document.querySelectorAll('button[aria-label="Profile menu"]').length,
);
ok(mobileOk === 1, 'a phone signs in alongside the desktop rather than evicting it');

await b.page.bringToFront();
await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
await b.page.waitForTimeout(4000);
const bStill = await b.page.evaluate(
  () => document.querySelectorAll('button[aria-label="Profile menu"]').length,
);
ok(bStill === 1, 'and the desktop is untouched by the phone signing in');

await browser.close();
console.log(`\naccount: ${email}`);
console.log(`\n${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
