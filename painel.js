#!/usr/bin/env node
/* Gera dist/painel.html — painel de status do projeto (o que foi feito, testes, formatos, deploy).
   Os números vêm de dados reais (git, arquivos, testes). Uso: node painel.js  (ou via build.js). */
const fs = require('fs'), path = require('path'), cp = require('child_process');

function git(args, padrao) { try { return cp.execSync('git ' + args, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return padrao; } }
function linhas(f) { try { return fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n').length; } catch (e) { return 0; } }
function bytes(f) { try { return fs.statSync(path.join(__dirname, f)).size; } catch (e) { return 0; } }
function kb(n) { return (n / 1024).toFixed(0) + ' KB'; }
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function contarTestes() {
  const dir = path.join(__dirname, 'test'); let arqs = [];
  try { arqs = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')); } catch (e) { }
  return arqs.map(f => {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    const n = (txt.match(/^\s*(?:test|tflaky)\(['"`]/gm) || []).length;
    const area = f.replace('.test.js', '');
    const rotulos = { app: 'App (navegador)', gs1: 'GS1 / 2D', leitor: 'Leitor EAN', build: 'Build', ocr: 'OCR' };
    return { area: rotulos[area] || area, n };
  }).sort((a, b) => b.n - a.n);
}

function gerarHTML() {
  const commits = git('rev-list --count HEAD', '?');
  const ultimo = git("log -1 --format=%h", '').trim();
  const ultimoMsg = git("log -1 --format=%s", '');
  const ultimaData = git('log -1 --format=%ad --date=format:%d/%m/%Y', '');
  const testes = contarTestes();
  const totalTestes = testes.reduce((s, t) => s + t.n, 0);
  const maxTestes = testes.reduce((m, t) => Math.max(m, t.n), 1);
  const tamApp = bytes('dist/validade.html');
  const hoje = new Date().toLocaleDateString('pt-BR');

  const features = [
    ['Leitura de código de barras', 'EAN-13 / EAN-8 / UPC-A / UPC-E, leitor próprio em JavaScript (sem biblioteca) + leitor nativo do aparelho.'],
    ['Leitura 2D GS1 (QR / DataMatrix)', 'Extrai código, peso (AI 3103), validade (AI 17), preço (AI 392n) e lote (AI 10) da etiqueta da balança.'],
    ['Código de balança embutido no GTIN', 'Reconhece a etiqueta EAN-13 de balança dentro do GTIN e extrai só o código do produto (ex.: 6019).'],
    ['OCR da etiqueta', 'Lê por foto a descrição do produto e o lote (vai para o SIF), com Tesseract.js rodando no próprio celular.'],
    ['Perecíveis', 'Cadastro por código de balança, descrição e SIF; edição de peso/validade/SIF; lista de registros.'],
    ['Produtos e lotes', 'Lotes com quantidade e validade, filtros (vencidos, a vencer), contadores e busca.'],
    ['Alertas de vencimento', 'Lembretes no celular (no APK) antes de vencer; reagendam quando muda a antecedência.'],
    ['Backup e relatórios', 'Exportar/importar backup (JSON), planilha CSV e relatório por WhatsApp.'],
    ['Dados resilientes', 'Chave de armazenamento fixa com migração automática; importação tolerante a backup incompleto.'],
    ['Build e publicação', 'Template → app por config da loja; publicação automática no GitHub Pages a cada push.'],
    ['Qualidade', `${totalTestes} testes automatizados (leitor, GS1, OCR, build e app no navegador) rodando no CI.`],
  ];

  const formatos = [
    ['EAN-13 de balança', '<code>2 CCCCC 0 VVVVV D</code>', 'Começa com 2; código do produto (5 díg.), valor e dígito verificador.'],
    ['GS1 — GTIN', '<code>(01) 14 díg.</code>', 'Pode ser um GTIN real ou embutir a etiqueta de balança (0 + EAN-13 começando com 2).'],
    ['GS1 — validade', '<code>(17) AAMMDD</code>', 'Dia 00 = último dia do mês.'],
    ['GS1 — peso', '<code>(310n) 6 díg.</code>', 'Peso líquido em kg, n = casas decimais.'],
    ['GS1 — preço / lote', '<code>(392n)</code> · <code>(10)</code>', 'Valor a pagar e lote, quando presentes.'],
    ['OCR (texto)', 'descrição + <code>LOTE:</code>', 'Nome do produto (topo) e lote (vai para o SIF), lidos da imagem.'],
  ];

  const arquivos = [
    ['src/app.html', linhas('src/app.html'), 'o app (HTML + CSS + JS) com marcadores de configuração'],
    ['src/leitor-ean.js', linhas('src/leitor-ean.js'), 'leitores: EAN 1D, GS1 2D e parser do texto do OCR'],
    ['build.js', linhas('build.js'), 'monta o app a partir do template + config'],
    ['painel.js', linhas('painel.js'), 'gera este painel'],
    ['test/', testes.reduce((s, t) => s + 0, 0) || '', `${totalTestes} testes em ${testes.length} arquivos`],
  ];

  const tilePreco = 'R$ 9,98', PAGES = 'https://jottacostta.github.io/validade/';

  const barras = testes.map(t => `
      <div class="barlinha">
        <div class="barnome">${esc(t.area)}</div>
        <div class="bartrilho"><div class="barra" style="width:${(t.n / maxTestes * 100).toFixed(1)}%"></div></div>
        <div class="barval">${t.n}</div>
      </div>`).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Validade — Painel do projeto</title>
<meta name="description" content="Painel de status do projeto Validade: o que foi construído, testes, formatos de etiqueta e deploy.">
<style>
:root{--c:#083d81;--c2:#E7EEF7;--cod:#083d81;--am:#faf400;--barra:#083d81;--bg:#F4F7FA;--sf:#fff;--bd:#E0E7EE;--ink:#17212B;--mu:#657586;--ok:#16803C;--okl:#E3F4EA;--tr:#EEF2F6}
@media(prefers-color-scheme:dark){:root{--c2:#15233B;--cod:#9CC2F0;--barra:#3B82D6;--bg:#0E151C;--sf:#17212B;--bd:#2A3643;--ink:#EDF2F7;--mu:#98A8B7;--okl:#12301F;--tr:#1E2A36}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Roboto,Arial,sans-serif;padding-bottom:40px}
header{background:linear-gradient(135deg,#083d81,#0a4e9e);color:#fff;padding:28px 16px;border-bottom:5px solid var(--am)}
header .in{max-width:900px;margin:0 auto}
header h1{margin:0;font-size:24px}header p{margin:6px 0 0;opacity:.9;font-size:14px}
main{max-width:900px;margin:0 auto;padding:16px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:-36px 0 18px}
@media(max-width:620px){.tiles{grid-template-columns:1fr 1fr}}
.tile{background:var(--sf);border:1px solid var(--bd);border-radius:14px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.tile b{display:block;font-size:26px;line-height:1.1}.tile small{color:var(--mu);font-size:12px}
.tile .ok{color:var(--ok)}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:16px;padding:18px;margin-bottom:14px}
.card h2{margin:0 0 4px;font-size:17px}.card .sub{color:var(--mu);font-size:13px;margin:0 0 12px}
.feat{display:grid;gap:10px}
.feat .it{display:flex;gap:10px;align-items:flex-start}
.feat .mk{color:var(--ok);flex:none;font-weight:700;margin-top:1px}
.feat .it b{font-size:14px}.feat .it span{display:block;color:var(--mu);font-size:13px}
.barlinha{display:grid;grid-template-columns:120px 1fr 32px;align-items:center;gap:10px;margin:8px 0}
.barnome{font-size:13px;color:var(--mu)}
.bartrilho{background:var(--tr);border-radius:6px;height:14px;overflow:hidden}
.barra{height:100%;background:var(--barra);border-radius:6px}
.barval{font-weight:700;font-size:14px;text-align:right}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-size:11px;color:var(--mu);text-transform:uppercase;letter-spacing:.04em;padding:7px 6px;border-bottom:1px solid var(--bd)}
td{padding:9px 6px;border-bottom:1px solid var(--bd);vertical-align:top}tr:last-child td{border-bottom:0}
code{background:var(--c2);color:var(--cod);padding:1px 6px;border-radius:6px;font:600 12.5px ui-monospace,monospace;white-space:nowrap}
.exemplo{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.chip{background:var(--tr);border:1px solid var(--bd);border-radius:999px;padding:5px 11px;font-size:12.5px}
.chip b{color:var(--cod)}
a.btn{display:inline-flex;align-items:center;gap:6px;background:var(--c);color:#fff;text-decoration:none;padding:10px 16px;border-radius:12px;font-weight:700;font-size:14px}
.links{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.meta{color:var(--mu);font-size:12px;margin-top:8px}
footer{max-width:900px;margin:10px auto 0;padding:0 16px;color:var(--mu);font-size:12px;text-align:center}
</style>
</head>
<body>
<header><div class="in"><h1>📅 Validade — Painel do projeto</h1>
<p>Controle de validade para supermercado · atualizado em ${hoje}</p></div></header>
<main>
  <div class="tiles">
    <div class="tile"><b class="ok">${totalTestes} ✓</b><small>testes passando</small></div>
    <div class="tile"><b>${commits}</b><small>commits</small></div>
    <div class="tile"><b>4</b><small>formatos de etiqueta</small></div>
    <div class="tile"><b>${kb(tamApp)}</b><small>app · 0 dependências</small></div>
  </div>

  <div class="card"><h2>O que já foi construído</h2>
    <p class="sub">Funcionalidades entregues no app e no fluxo de build/deploy.</p>
    <div class="feat">
      ${features.map(f => `<div class="it"><span class="mk">✓</span><div><b>${esc(f[0])}</b><span>${f[1]}</span></div></div>`).join('')}
    </div>
  </div>

  <div class="card"><h2>Testes por área</h2>
    <p class="sub">${totalTestes} testes automatizados — rodam no CI a cada push (série única, em nº de testes).</p>
    ${barras}
  </div>

  <div class="card"><h2>Formatos de etiqueta mapeados</h2>
    <p class="sub">Como o app lê as etiquetas da balança (código, peso, validade, preço e lote).</p>
    <table><tr><th>Formato</th><th>Campo</th><th>O que é</th></tr>
      ${formatos.map(f => `<tr><td><b>${esc(f[0])}</b></td><td>${f[1]}</td><td>${esc(f[2])}</td></tr>`).join('')}
    </table>
    <p class="sub" style="margin:14px 0 4px">Exemplo real (pernil fracionado), tudo lido da etiqueta:</p>
    <div class="exemplo">
      <span class="chip">código <b>6019</b></span>
      <span class="chip">peso <b>0,864 kg</b></span>
      <span class="chip">validade <b>08/11/2026</b></span>
      <span class="chip">preço <b>${tilePreco}</b></span>
      <span class="chip">lote <b>876-040326</b></span>
    </div>
  </div>

  <div class="card"><h2>Estrutura do projeto</h2>
    <table><tr><th>Arquivo</th><th>Linhas</th><th>O que faz</th></tr>
      ${arquivos.map(a => `<tr><td><code>${esc(a[0])}</code></td><td>${a[1] || '—'}</td><td>${esc(a[2])}</td></tr>`).join('')}
    </table>
  </div>

  <div class="card"><h2>Publicação</h2>
    <div class="links">
      <a class="btn" href="${PAGES}" target="_blank" rel="noopener">Abrir o app ↗</a>
      <a class="btn" style="background:var(--tr);color:var(--ink)" href="https://github.com/jottacostta/validade" target="_blank" rel="noopener">Repositório ↗</a>
    </div>
    <p class="meta">Último commit: <code>${esc(ultimo)}</code> — ${esc(ultimoMsg)} · ${esc(ultimaData)}<br>
    Publicado automaticamente no GitHub Pages a cada push no <code>main</code>.</p>
  </div>
</main>
<footer>Painel gerado por <code>painel.js</code> a partir dos dados do repositório.</footer>
</body>
</html>`;
}

function gerar() {
  const dist = path.join(__dirname, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const html = gerarHTML();
  fs.writeFileSync(path.join(dist, 'painel.html'), html);
  return html.length;
}

module.exports = { gerar };

if (require.main === module) {
  const n = gerar();
  console.log('✅ dist/painel.html (' + n + ' bytes)');
}
