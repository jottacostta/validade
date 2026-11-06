/* Gera imagens sintéticas de código de barras (formato ImageData) para testar o leitor. */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = L.map(s => [...s].map(b => (b === '1' ? '0' : '1')).reverse().join(''));
const R = L.map(s => [...s].map(b => (b === '1' ? '0' : '1')).join(''));
const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function bits(c) {
  if (c.length === 12) c = '0' + c; // UPC-A = EAN-13 com 0 na frente
  if (c.length === 8) {
    let s = '101';
    for (let i = 0; i < 4; i++) s += L[+c[i]];
    s += '01010';
    for (let i = 4; i < 8; i++) s += R[+c[i]];
    return s + '101';
  }
  const p = PAR[+c[0]];
  let s = '101';
  for (let i = 1; i < 7; i++) s += (p[i - 1] === 'L' ? L : G)[+c[i]];
  s += '01010';
  for (let i = 7; i < 13; i++) s += R[+c[i]];
  return s + '101';
}

/* opções: modulo (px por barra), altura, espelhar, borrar (raio), ruido (0–255), escuro/claro */
function imagem(codigo, o = {}) {
  const m = o.modulo || 3, H = o.altura || 30, q = '0'.repeat(12);
  let b = q + bits(codigo) + q;
  if (o.espelhar) b = [...b].reverse().join('');
  const W = b.length * m, esc = o.escuro ?? 25, clr = o.claro ?? 230;
  let lin = new Float32Array(W);
  for (let x = 0; x < W; x++) lin[x] = b[Math.floor(x / m)] === '1' ? esc : clr;
  if (o.borrar) {
    const r = o.borrar, s = new Float32Array(W);
    for (let x = 0; x < W; x++) { let t = 0, n = 0; for (let k = -r; k <= r; k++) { const i = x + k; if (i >= 0 && i < W) { t += lin[i]; n++; } } s[x] = t / n; }
    lin = s;
  }
  let semente = 7; const aleat = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = lin[x] + (o.ruido ? (aleat() - 0.5) * o.ruido : 0), i = (y * W + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return { width: W, height: H, data: d };
}

function ruido(W, H) {
  let semente = 3; const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < d.length; i++) d[i] = (semente = (semente * 16807) % 2147483647) % 256;
  return { width: W, height: H, data: d };
}

module.exports = { imagem, ruido, bits };
