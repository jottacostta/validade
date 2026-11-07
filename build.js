#!/usr/bin/env node
/* Monta o app de validade a partir do template.
   Uso: node build.js [config.json]
   Gera:
     dist/validade.html     app pronto (abre no navegador ou vai para o ApkForja como arquivo)
     dist/APP_VALIDADE.js   template + leitor no formato que o ApkForja embute (const APP_VALIDADE / LEITOR_EAN) */
const fs = require('fs'), path = require('path');
const raiz = __dirname, ler = f => fs.readFileSync(path.join(raiz, f), 'utf8');

/* auxiliares iguais aos do ApkForja (manter em sincronia) */
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const soDig = t => String(t || '').replace(/\D/g, '');
const zap = n => { let d = soDig(n); if (d && d.length <= 11) d = '55' + d; return d; };
const J = o => JSON.stringify(o).replace(/</g, '\\u003c');
function clarear(hex, p) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255; r = Math.round(r + (255 - r) * p); g = Math.round(g + (255 - g) * p); b = Math.round(b + (255 - b) * p); return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }

const MARCADORES = ['/*COR*/', '/*COR2*/', '/*COR3*/', '/*CORDARK*/', '/*ACENTO*/', '/*NOME_HTML*/', '/*CFG*/', '/*LEITOR*/'];

/* logo: usa config.logo (URL/dataURI) ou embute src/logo.png como data URI */
function logoDataURI() {
  try {
    const j = path.join(raiz, 'src/logo.jpg'); if (fs.existsSync(j)) return 'data:image/jpeg;base64,' + fs.readFileSync(j).toString('base64');
    const p = path.join(raiz, 'src/logo.png'); if (fs.existsSync(p)) return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  } catch (e) {}
  return '';
}

/* config da loja → { html, js, cfg } (sem gravar nada) */
function montar(c) {
  const APP = ler('src/app.html'), LEITOR = ler('src/leitor-ean.js');
  const cor = /^#[0-9a-fA-F]{6}$/.test(c.cor || '') ? c.cor : '#0B6E4F';
  const acento = /^#[0-9a-fA-F]{6}$/.test(c.acento || '') ? c.acento : '#FFC20E';
  const cfg = { cosmos: String(c.cosmos || '').trim(), nome: c.nome || 'Controle de Validade', slogan: String(c.slogan || '').trim(), zap: zap(c.whatsapp),
    dias: Math.max(1, parseInt(c.dias) || 30), dig: +c.dig || 4, valor: c.valor === 'preco' ? 'preco' : 'peso',
    supaUrl: String(c.supaUrl || '').trim().replace(/\/$/, ''), supaKey: String(c.supaKey || '').trim(), loginDom: String(c.loginDom || 'loja.validade').trim(), logo: (String(c.logo || '').trim() || logoDataURI()) };
  if (![4, 5, 6].includes(cfg.dig)) throw new Error('dig deve ser 4, 5 ou 6');
  const html = APP.split('/*COR*/').join(cor).split('/*COR2*/').join(clarear(cor, .88)).split('/*COR3*/').join(clarear(cor, .3))
    .split('/*CORDARK*/').join(clarear(cor, .4)).split('/*ACENTO*/').join(acento)
    .split('/*NOME_HTML*/').join(esc(cfg.nome)).replace('/*CFG*/', () => J(cfg)).replace('/*LEITOR*/', () => LEITOR);
  for (const p of MARCADORES) if (html.includes(p)) throw new Error('marcador não substituído: ' + p);
  const js = '/* Gerado por build.js — cole no ApkForja no lugar das constantes atuais */\n' +
    'const APP_VALIDADE=' + JSON.stringify(APP) + ';\n' + 'const LEITOR_EAN=' + JSON.stringify(LEITOR) + ';\n';
  return { html, js, cfg };
}

module.exports = { montar, esc, zap, clarear, MARCADORES };

if (require.main === module) {
  const cfgArq = process.argv[2] || 'config.json';
  const { html, js } = montar(JSON.parse(fs.readFileSync(path.resolve(raiz, cfgArq), 'utf8')));
  fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'dist/validade.html'), html);
  fs.writeFileSync(path.join(raiz, 'dist/APP_VALIDADE.js'), js);
  console.log('✅ dist/validade.html (' + html.length + ' bytes) e dist/APP_VALIDADE.js');
  try { require('./painel').gerar(); console.log('✅ dist/painel.html'); } catch (e) { console.log('painel não gerado: ' + e.message); }
}
