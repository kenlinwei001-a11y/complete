const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const la = L(a), lb = L(b); const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return (hi + 0.05) / (lo + 0.05); };

const themes = {
  dark: { txt: '#e9eef5', muted: '#b1bece', muted2: '#9ba9b7', panel: '#2c3d5e', bg: '#223251', bg2: '#283a5c', panel2: '#1c2942' },
  light: { txt: '#14203a', muted: '#475069', muted2: '#5b6577', panel: '#ffffff', bg: '#f5f7fb', bg2: '#ffffff', panel2: '#edf1f7' },
  warm: { txt: '#1c1c1c', muted: '#8a8a8a', muted2: '#bebebe', panel: '#ffffff', bg: '#f9f9f9', bg2: '#ffffff', panel2: '#f2f2f2' },
};
const darkCandidates = ['#2c3d5e', '#33456a', '#374a72', '#3a4e78', '#2f4165'];
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n== ${name} ==`);
  const cands = name === 'dark' ? darkCandidates : [t.panel, t.bg2, t.panel2];
  for (const surf of cands) {
    const acc = name === 'dark' ? '#4c90f0' : (name === 'light' ? '#3b5bdb' : '#E8590C');
    console.log(`  surface ${surf}: txt ${ratio(t.txt, surf).toFixed(2)}  muted ${ratio(t.muted, surf).toFixed(2)}  muted2 ${ratio(t.muted2, surf).toFixed(2)}  accent ${ratio(acc, surf).toFixed(2)}`);
  }
}
const over = (fg, alpha, bg) => { const F = hex(fg), B = hex(bg); return '#' + [0, 1, 2].map(i => Math.round(F[i] * alpha + B[i] * (1 - alpha)).toString(16).padStart(2, '0')).join(''); };
const glassOverBg = over('#ffffff', 0.06, '#223251');
console.log('\n== 现状 dark .panel 玻璃合成（底=--bg 空白处）:', glassOverBg, ' txt', ratio('#e9eef5', glassOverBg).toFixed(2), ' muted2', ratio('#9ba9b7', glassOverBg).toFixed(2));
const glassOverText = over('#ffffff', 0.06, '#e9eef5');
console.log('== 现状 dark 浮层压在底层正文字形上（底=--txt #e9eef5）:', glassOverText, ' 浮层 txt 文字对比', ratio('#e9eef5', glassOverText).toFixed(2), ' 浮层 muted2', ratio('#9ba9b7', glassOverText).toFixed(2));
const glassOverTextLight = over('#ffffff', 1, '#14203a');
console.log('== light/.panel(--panel-glass=#fff 不透明) 压在正文上:', glassOverTextLight, ' txt', ratio('#14203a', glassOverTextLight).toFixed(2));
