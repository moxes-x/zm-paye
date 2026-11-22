// Screenshots a URL in a Chromium browser over the DevTools protocol.
// Usage: node scripts/capture.mjs <debug-port> <url> <out.png> <width> <height> [light|dark] [screen|print]
// Start the browser first with --headless=new --remote-debugging-port=<debug-port>.
import { writeFileSync } from 'node:fs';

const [, , port, url, out, width = '1200', height = '630', scheme = 'light', media = 'screen'] = process.argv;
if (!port || !url || !out) {
  console.error('Usage: node scripts/capture.mjs <port> <url> <out.png> [width] [height] [light|dark] [screen|print]');
  process.exit(1);
}

const base = `http://127.0.0.1:${port}`;
const target = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) pending.get(message.id)(message.result);
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width),
  height: Number(height),
  deviceScaleFactor: 1,
  mobile: Number(width) < 600,
});
// MOTION=reduce emulates a reduced-motion preference, which also skips scroll fade-ins.
await send('Emulation.setEmulatedMedia', {
  media,
  features: [
    { name: 'prefers-color-scheme', value: scheme },
    { name: 'prefers-reduced-motion', value: process.env.MOTION === 'reduce' ? 'reduce' : 'no-preference' },
  ],
});
await send('Page.navigate', { url });
await new Promise((resolve) => setTimeout(resolve, 1500));

// Optional SECTION env var: start the screenshot at the element with that id.
let clip;
if (process.env.SECTION) {
  const { result: top } = await send('Runtime.evaluate', {
    expression: `document.getElementById(${JSON.stringify(process.env.SECTION)}).getBoundingClientRect().top + scrollY`,
  });
  clip = { x: 0, y: top.value, width: Number(width), height: Number(height), scale: 1 };
}
const { data } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: Boolean(clip) });
writeFileSync(out, Buffer.from(data, 'base64'));

// Report horizontal overflow, which should never happen at any width.
const { result } = await send('Runtime.evaluate', {
  expression: 'document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth',
});
console.log(`${out}: page width ${result.value}`);
await fetch(`${base}/json/close/${target.id}`);
ws.close();
