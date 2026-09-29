// Headless-Chrome capture via raw CDP (Node 22 has fetch + WebSocket built in).
// usage: node tools/shot.js name "query" [name "query" ...]   e.g.  node tools/shot.js calm "sea=1&hour=10"
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = +process.env.W || 1600, H = +process.env.H || 900, PORT = 9333 + Math.floor(Math.random()*300);
const WAIT = +process.env.WAIT || 240;           // frames to wait (sim warm-up)
const args = process.argv.slice(2);
(async () => {
  const prof = path.join(process.env.TEMP, 'ocean-chrome-' + PORT);
  const ch = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof,
    '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--hide-scrollbars',
    '--window-size=' + W + ',' + H, '--force-device-scale-factor=1', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch (e) {} await new Promise(r => setTimeout(r, 250)); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; const logs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    else if (d.method === 'Runtime.consoleAPICalled') logs.push('[' + d.params.type + '] ' + d.params.args.map(a => a.value ?? a.description).join(' '));
    else if (d.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], q = args[i + 1] || '';
    logs.length = 0;
    await send('Page.navigate', { url: `${process.env.FILEURL || "http://localhost:8137/index.html"}?${process.env.LIVE ? "" : "still=1&"}${q}${process.env.UI ? "" : "&hideui=1"}` });
    const t0 = Date.now(); let fr = 0, fps = 0;
    while (Date.now() - t0 < 180000) {
      await new Promise(r => setTimeout(r, 500));
      const r = await send('Runtime.evaluate', { expression: 'window.__frame|0', returnByValue: true });
      fr = r.result?.result?.value || 0;
      if (fr >= WAIT) break;
      if (logs.some(l => /ERROR|EXC|error/i.test(l)) && fr < 2 && Date.now() - t0 > 6000) break;
    }
    const dt = (Date.now() - t0) / 1000;
    const stats = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__stats||{})', returnByValue: true });
    if (process.env.EVAL) { const ev = await send('Runtime.evaluate', { expression: process.env.EVAL, returnByValue: true, awaitPromise: true }); console.log('EVAL:', JSON.stringify(ev.result?.result?.value ?? ev.result)); }
    await new Promise(r => setTimeout(r, 300));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('shots', { recursive: true });
    fs.writeFileSync(path.join('shots', name + '.png'), Buffer.from(shot.result.data, 'base64'));
    console.log(`== ${name}: frames=${fr} in ${dt.toFixed(1)}s stats=${stats.result?.result?.value}`);
    logs.slice(0, 25).forEach(l => console.log('   ' + l.slice(0, 600)));
  }
  ws.close(); ch.kill();
  setTimeout(() => process.exit(0), 500);
})();
