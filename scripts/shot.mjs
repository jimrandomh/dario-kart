// Headless screenshot/playtest helper.
//
//   node scripts/shot.mjs <url-or-hash> <out.png> [steps-json]
//
// <url-or-hash> may be a full URL or just a hash like "#debug=airace" (dev server assumed on :5199).
// steps-json is an optional JSON array of actions run in order before the final screenshot:
//   {"wait": ms}                         sleep
//   {"click": "css selector"}            click an element
//   {"clickAt": [x, y]}                  click at page coordinates
//   {"move": [x, y]}                     move the mouse (hover) to page coordinates
//   {"type": "text"}                     type text via the keyboard
//   {"press": "Enter"}                   press a key (Playwright key names, e.g. "ArrowUp")
//   {"down": "ArrowUp"} / {"up": "ArrowUp"}   hold / release a key
//   {"eval": "js expression"}            evaluate in the page; result is printed
//   {"shot": "path.png"}                 take an intermediate screenshot
// Console errors and page errors are printed to stdout.
import { chromium } from 'playwright';

const [, , target, out = 'shot.png', stepsJson = '[]'] = process.argv;
if (!target) {
  console.error('usage: node scripts/shot.mjs <url-or-hash> <out.png> [steps-json]');
  process.exit(2);
}
const url = target.startsWith('http') ? target : `http://localhost:5199/${target.startsWith('#') ? '' : '#'}${target}`;
const steps = JSON.parse(stepsJson);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(1200);
for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.click) await page.click(s.click);
  if (s.clickAt) await page.mouse.click(s.clickAt[0], s.clickAt[1]);
  if (s.move) await page.mouse.move(s.move[0], s.move[1]);
  if (s.type) await page.keyboard.type(s.type, { delay: 15 });
  if (s.press) await page.keyboard.press(s.press);
  if (s.down) await page.keyboard.down(s.down);
  if (s.up) await page.keyboard.up(s.up);
  if (s.eval) console.log('[eval]', JSON.stringify(await page.evaluate(s.eval)));
  if (s.shot) await page.screenshot({ path: s.shot });
}
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
