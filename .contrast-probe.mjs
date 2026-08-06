const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const la = L(a), lb = L(b); const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return (hi + 0.05) / (lo + 0.05); };
const over = (fg, alpha, bg) => { const F = hex(fg), B = hex(bg); return '#' + [0, 1, 2].map(i => Math.round(F[i] * alpha + B[i] * (1 - alpha)).toString(16).padStart(2, '0')).join(''); };

// 现状：三套主题下浮层（.panel）实际合成背景
const cases = [
  { theme: 'dark',  glass: ['#ffffff', 0.06], txt: '#e9eef5', muted: '#b1bece', muted2: '#9ba9b7', backdrops: { '页面底 --bg': '#223251', '卡面 --panel': '#2c3d5e', '底层正文字形 --txt': '#e9eef5', '底层次要文字 --muted': '#b1bece' } },
  { theme: 'light', glass: ['#ffffff', 1.00], txt: '#14203a', muted: '#475069', muted2: '#5b6577', backdrops: { '页面底 --bg': '#f5f7fb', '卡面 --panel': '#ffffff', '底层正文字形 --txt': '#14203a', '底层次要文字 --muted': '#475069' } },
  { theme: 'warm',  glass: ['#ffffff', 0.55], txt: '#1c1c1c', muted: '#8a8a8a', muted2: '#bebebe', backdrops: { '页面底 --bg': '#f9f9f9', '卡面 --panel': '#ffffff', '底层正文字形 --txt': '#1c1c1c', '底层次要文字 --muted': '#8a8a8a' } },
];
console.log('════ 现状（.panel 磨砂玻璃）：浮层文字对比度随「底下是什么」剧烈漂移 ════');
for (const c of cases) {
  console.log(`\n【${c.theme}】veil = rgba(255,255,255,${c.glass[1]})`);
  for (const [name, bd] of Object.entries(c.backdrops)) {
    const comp = over(c.glass[0], c.glass[1], bd);
    console.log(`  底=${name.padEnd(22)} → 合成 ${comp}  txt ${ratio(c.txt, comp).toFixed(2).padStart(6)}  muted ${ratio(c.muted, comp).toFixed(2).padStart(6)}  muted2 ${ratio(c.muted2, comp).toFixed(2).padStart(6)}`);
  }
}
console.log('\n════ 修后（不透明表面）：合成 ≡ 表面色，与底下无关 ════');
const solid = { dark: '#2c3d5e', light: '#ffffff', warm: '#ffffff' };
for (const c of cases) {
  const s = solid[c.theme];
  console.log(`【${c.theme}】surface ${s} → txt ${ratio(c.txt, s).toFixed(2)}  muted ${ratio(c.muted, s).toFixed(2)}  muted2 ${ratio(c.muted2, s).toFixed(2)}（四种底下同一个数）`);
}
