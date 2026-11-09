const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261109000000_area_operador_compartilhamento_alertas.sql'), 'utf8');
const rolesMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261108130000_matriz_papeis_ownership_rls.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/alertas/index.ts'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build.js'), 'utf8');

test('sincronização lê associação loja/EAN e busca a ficha no catálogo compartilhado', () => {
  assert.match(app, /baixar\('produtos','ean,created_by,updated_at,deleted_at'\)/);
  assert.doesNotMatch(app, /baixar\('produtos','[^']*\bnome\b/);
  assert.match(app, /function catalogoPull\(\)/);
});

test('backup nunca envia identidade/nome de autoria definidos pelo trigger', () => {
  assert.match(app, /delete clean\.created_by;delete clean\.created_by_nome;return clean;/);
  assert.match(app, /created_by é identidade definida pelo trigger do banco/);
});

test('frontend não lê nome do produto da tabela de associação', () => {
  assert.doesNotMatch(app, /if\(row\.nome&&!p\.desc\)p\.desc=row\.nome/);
});

test('perfis autorizados a cadastrar e campos de setor validados no cliente', () => {
  assert.match(app, /if\(acao==='registrar'\)return \['operador','assistente','analista','gerente'\]\.includes\(p\);/);
  assert.match(app, /SETORES\.includes\(setor\)/);
  assert.match(app, /p_setor:setor/);
});

test('matriz de papéis do banco aceita gerente e concede insert a papéis globais', () => {
  assert.match(rolesMigration, /check \(papel in \('operador','assistente','analista','gerente','admin'\)\)/);
  assert.match(rolesMigration, /private\.tem_escopo_global\(\).*private\.meu_papel\(\) <> ''admin''/);
  assert.match(rolesMigration, /array\['analista','gerente','admin'\]/);
});

test('lote é gravado atomicamente por RPC, incluindo catálogo, associação, setor e autoria do servidor', () => {
  assert.match(app, /\/rest\/v1\/rpc\/registrar_lote/);
  assert.match(app, /reg\.created_by_nome=serverRow\.created_by_nome/);
  assert.match(app, /created_by_nome,updated_at,deleted_at/);
  assert.match(migration, /create or replace function public\.registrar_lote/);
  assert.match(migration, /insert into public\.catalogo/);
  assert.match(migration, /private\.membro_da\(p_loja_id\)/);
  assert.match(migration, /private\.tem_escopo_global\(\) or private\.membro_da\(p_loja_id\)/);
  assert.match(migration, /new\.created_by := auth\.uid\(\)/);
  assert.match(migration, /O nome de autoria não pode ser alterado/);
});

test('perecível usa RPC atômica para item + registro e propaga setor/informante', () => {
  assert.match(app, /\/rest\/v1\/rpc\/registrar_perecivel/);
  assert.match(app, /r\.created_by_nome=serverRow\.created_by_nome/);
  assert.match(app, /baixar\('pere_regs','[^']*setor,created_by,created_by_nome/);
  assert.match(migration, /create or replace function public\.registrar_perecivel/);
  assert.match(migration, /insert into public\.pere_itens/);
  assert.match(migration, /insert into public\.pere_regs/);
});

test('alertas internos são escopados à loja e só o destinatário pode ler/marcar como lidos', () => {
  assert.match(app, /\/rest\/v1\/notificacoes\?select=id,tipo,titulo,mensagem,payload,criado,lida_em&loja_id=eq\./);
  assert.match(migration, /create table if not exists public\.notificacoes/);
  assert.match(migration, /create policy notificacoes_sel_own_store[\s\S]*user_id=\(select auth\.uid\(\)\)[\s\S]*private\.membro_da\(loja_id\)/);
  assert.match(migration, /create policy notificacoes_upd_own_store[\s\S]*user_id=\(select auth\.uid\(\)\)/);
  assert.match(migration, /coalesce\(auth\.role\(\),''\) <> 'service_role'/);
});

test('PWA publica service worker, manifest e ícones necessários', () => {
  assert.match(app, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(app, /serviceWorker\.register\('\.\/service-worker\.js'\)/);
  assert.match(build, /manifest\.webmanifest.*service-worker\.js.*logo\.jpg.*pwa-icon-192\.png/);
  assert.ok(fs.existsSync(path.join(root, 'src/service-worker.js')));
  assert.ok(fs.existsSync(path.join(root, 'src/manifest.webmanifest')));
  assert.ok(fs.existsSync(path.join(root, 'src/pwa-icon-192.png')));
});

test('Edge Function valida membership e não registra endpoint ou chaves no log', () => {
  assert.match(edge, /isMember\(user\.id, lojaId\)/);
  assert.match(edge, /function validPushEndpoint\(value: string\)/);
  assert.match(edge, /url\.protocol !== "https:"/);
  assert.match(edge, /push\.services\.mozilla\.com/);
  assert.match(edge, /validPushEndpoint\(endpoint\)/);
  assert.match(edge, /push_subscriptions/);
  assert.doesNotMatch(edge, /console\.(log|error|warn)\([^\n]*(endpoint|p256dh|auth)/i);
  assert.match(edge, /status === 404 \|\| status === 410/);
});
