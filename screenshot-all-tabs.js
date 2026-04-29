const p = require('puppeteer');
const eventId = '0b167a41-6810-4e14-9fdf-9d970d6dc0fb'; // Shimshon 96 markets

(async () => {
  const b = await p.launch({ headless: true });
  const page = await b.newPage();
  await page.setViewport({ width: 1400, height: 1200 });
  await page.goto(`http://localhost:3000/sport/${eventId}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Get all category tab labels
  const tabLabels = await page.evaluate(() => {
    const container = document.querySelector('[class*="overflow-x-auto"]') || document.body;
    const btns = container.querySelectorAll('button');
    return Array.from(btns).map(b => b.textContent?.trim() || '').filter(t => t.length > 0 && t.length < 30);
  });
  console.log('Tabs found:', tabLabels);

  // Screenshot each tab
  for (let i = 0; i < tabLabels.length; i++) {
    const label = tabLabels[i];
    const safeName = label.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

    // Click the tab
    await page.evaluate((labelText) => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (btn.textContent?.trim() === labelText) { btn.click(); return; }
      }
    }, label);

    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: `C:/Users/philp/Pictures/tab_${String(i).padStart(2,'0')}_${safeName}.png`, fullPage: true });
    console.log(`  [${i}] ${label} → screenshot saved`);
  }

  // Also check a prematch event with many markets
  const prematchResult = await page.evaluate(async () => {
    const res = await fetch('http://localhost:3000/api/scraper/stats');
    return res.ok;
  });

  // Find a prematch event with lots of markets
  await page.goto('http://localhost:3000/sport', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'C:/Users/philp/Pictures/sport_listing.png', fullPage: false });

  await b.close();
  console.log('done');
})();
