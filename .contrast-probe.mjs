const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const la = L(a), lb = L(b); const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return (hi + 0.05) / (lo + 0.05); };

// 暗色候选：比 --bg(#223251) / --panel(#2c3d5e) 更深 → 浮层自成一层且提高浅色文字对比
const dark = { txt: '#e9eef5', muted: '#b1bece', muted2: '#9ba9b7', accent: '#4c90f0', ok: '#62be77', danger: '#e0626c', amber: '#e8b54a' };
for (const s of ['#2c3d5e', '#26365a', '#1f2c47', '#1c2942', '#1a2540', '#182238']) {
  const r = (k) => ratio(dark[k], s).toFixed(2).padStart(6);
  console.log(`dark surface ${s}: txt${r('txt')} muted${r('muted')} muted2${r('muted2')} accent${r('accent')} ok${r('ok')} danger${r('danger')} amber${r('amber')}  |vs --bg#223251 ${ratio(s, '#223251').toFixed(2)}  |vs --panel#2c3d5e ${ratio(s, '#2c3d5e').toFixed(2)}`);
}
console.log();
const light = { txt: '#14203a', muted: '#475069', muted2: '#5b6577', accent: '#3b5bdb' };
for (const s of ['#ffffff', '#fdfeff']) {
  const r = (k) => ratio(light[k], s).toFixed(2).padStart(6);
  console.log(`light surface ${s}: txt${r('txt')} muted${r('muted')} muted2${r('muted2')} accent${r('accent')}`);
}
const warm = { txt: '#1c1c1c', muted: '#8a8a8a', muted2: '#bebebe', accent: '#E8590C' };
for (const s of ['#ffffff']) {
  const r = (k) => ratio(warm[k], s).toFixed(2).padStart(6);
  console.log(`warm  surface ${s}: txt${r('txt')} muted${r('muted')} muted2${r('muted2')} accent${r('accent')}`);
}
