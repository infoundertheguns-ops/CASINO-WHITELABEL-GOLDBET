const p = require('puppeteer');
(async () => {
  const b = await p.launch({ headless: true });
  const page = await b.newPage();
  await page.setViewport({ width: 1400, height: 1200 });

  // Basket event (37 markets)
  await page.goto('http://localhost:3000/sport/01db23d0-cd85-4577-922f-92e2706e185b', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'C:/Users/philp/Pictures/basket-principali.png', fullPage: false });
  // Click ALTRO tab for handicap markets
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) { if (btn.textContent?.includes('ALTRO')) { btn.click(); return; } }
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'C:/Users/philp/Pictures/basket-altro.png', fullPage: true });

  // Tennis event (31 markets)
  await page.goto('http://localhost:3000/sport/06bc7f4b-97b0-442f-ba9b-a506b5aa2628', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'C:/Users/philp/Pictures/tennis-principali.png', fullPage: false });
  // Click ALTRO tab
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) { if (btn.textContent?.includes('ALTRO')) { btn.click(); return; } }
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'C:/Users/philp/Pictures/tennis-altro.png', fullPage: true });

  await b.close();
  console.log('done');
})();
