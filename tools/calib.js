// bisect the foam J-threshold per sea state so that visible foam coverage hits targets
const { execFileSync } = require('child_process');
const targets = { 3: 0.003, 5: 0.022, 7: 0.065, 9: 0.145, 11: 0.24 };
function cov(sea, thr) {
  execFileSync('node', ['tools/shot.js', 'cal', `sea=${sea}&hour=12&clouds=0.4&cam=0,40,0,240,-32&warm=18&dbg=3&fthr=${thr}&yacht=0`], { env: { ...process.env, WAIT: '2' }, stdio: 'ignore' });
  const out = execFileSync('python', ['tools/cov.py', 'shots/cal.png']).toString();
  return parseFloat(/coverage\(mask>0.5\)=([\d.]+)/.exec(out)[1]);
}
const res = {};
for (const sea of Object.keys(targets)) {
  let lo = -0.5, hi = 1.6, best = 0;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2, c = cov(sea, mid);
    if (c < targets[sea]) lo = mid; else hi = mid; best = mid;
  }
  res[sea] = +best.toFixed(3); console.log('sea', sea, 'thr', res[sea]);
}
console.log(JSON.stringify(res));
