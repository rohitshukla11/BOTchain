/**
 * capture-positions.mjs
 * Takes two screenshots of My Positions using the ?preview_investor URL param.
 *
 * Usage:  node scripts/capture-positions.mjs
 */

// Use the npx-cached playwright package (version that matches the installed Chromium 1234).
const { chromium } = await import(
  '/home/rohit/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
);

const INVESTOR  = '0x48D8f72D20D8F9C0b7abab30AB846f4D82a08dc7';
const BASE_URL  = 'http://localhost:5173';
const PREVIEW   = `${BASE_URL}/?preview_investor=${INVESTOR}`;

const OUT_ALL       = '/tmp/positions_all.png';
const OUT_FUNDED    = '/tmp/positions_funded_card.png';
const OUT_EVIDENCE  = '/tmp/positions_evidence_card.png';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log('Navigating to', PREVIEW);
  await page.goto(PREVIEW, { waitUntil: 'domcontentloaded' });

  // Wait until the position cards appear OR the "Loading" indicator disappears.
  // Timeout 15 s — contract reads over the testnet RPC can be slow.
  try {
    await page.waitForSelector('.mp-position-card, .mp-closed-row, .vf-card', {
      timeout: 15_000,
    });
  } catch {
    console.warn('Position cards did not appear within 15 s — taking screenshot anyway.');
  }

  // Extra settle time for animations / RPC polling.
  await page.waitForTimeout(2000);

  // Full-page screenshot showing all positions.
  await page.screenshot({ path: OUT_ALL, fullPage: true });
  console.log('Saved:', OUT_ALL);

  // Scroll to and screenshot the first active card (Funded - Repayment Due).
  const fundedCard = page.locator('.mp-position-card').first();
  if (await fundedCard.isVisible()) {
    await fundedCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await fundedCard.screenshot({ path: OUT_FUNDED });
    console.log('Saved:', OUT_FUNDED);
  } else {
    console.warn('No .mp-position-card found for funded screenshot.');
  }

  // Screenshot the Evidence Submitted card (should have amber border styling).
  const allCards = page.locator('.mp-position-card');
  const count    = await allCards.count();
  for (let i = 0; i < count; i++) {
    const text = await allCards.nth(i).innerText();
    if (text.includes('Evidence Submitted')) {
      await allCards.nth(i).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await allCards.nth(i).screenshot({ path: OUT_EVIDENCE });
      console.log('Saved:', OUT_EVIDENCE);
      break;
    }
  }

  await browser.close();
  console.log('Done.');
}

run().catch(err => { console.error(err); process.exit(1); });
