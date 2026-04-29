const p = require('puppeteer');
(async () => {
  const b = await p.launch({ headless: true });
  const page = await b.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  // Prematch event with 36 markets
  await page.goto('http://localhost:3000/sport/5b1f40da-8b16-4b44-a81a-9839ac9a9be6', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'C:/Users/philp/Pictures/prematch-36-principali.png', fullPage: false });

  // Click 1X2 tab
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) { if (btn.textContent?.includes('1X2')) { btn.click(); return; } }
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'C:/Users/philp/Pictures/prematch-36-1x2.png', fullPage: false });

  // Click COMBO tab
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) { if (btn.textContent?.includes('COMBO')) { btn.click(); return; } }
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'C:/Users/philp/Pictures/prematch-36-combo.png', fullPage: true });

  // Click GOL tab
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) { if (btn.textContent?.includes('GOL')) { btn.click(); return; } }
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'C:/Users/philp/Pictures/prematch-36-gol.png', fullPage: true });

  await b.close();
  console.log('done');
})();
