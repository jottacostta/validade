const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261109000000_area_operador_compartilhamento_alertas.sql'), 'utf8');
const offlineRpcMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261109123000_offline_rpc_idempotency.sql'), 'utf8');
const rolesMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261108130000_matriz_papeis_ownership_rls.sql'), 'utf8');
const reviewerHardening = fs.readFileSync(path.join(root, 'supabase/migrations/20261109122158_harden_review_role_null.sql'), 'utf8');
const personalTokenPolicy = fs.readFileSync(path.join(root, 'supabase/migrations/20261109122302_restrict_personal_cosmos_token_access.sql'), 'utf8');
const foreignKeyIndexes = fs.readFileSync(path.join(root, 'supabase/migrations/20261109122348_index_audit_and_creator_foreign_keys.sql'), 'utf8');
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

test('revisão de exclusão falha fechado sem perfil ou papel', () => {
  assert.match(reviewerHardening, /coalesce\(v_papel,''\) not in \('assistente','analista','gerente','admin'\)/);
  assert.match(reviewerHardening, /not coalesce\(private\.tem_escopo_global\(\),false\) and not private\.membro_da\(r\.loja_id\)/);
  assert.match(reviewerHardening, /revoke all on function public\.revisar_solicitacao_exclusao\(uuid,boolean,text\) from public,anon/);
});

test('tokens pessoais do Cosmos continuam visíveis somente ao próprio usuário', () => {
  assert.match(personalTokenPolicy, /drop policy if exists preferencias_admin_all on public\.preferencias/);
  assert.match(personalTokenPolicy, /somente pelo próprio usuário autenticado/);
});

test('FKs de autoria e auditoria possuem índices dedicados', () => {
  for (const index of ['auditoria_user_id_fk_idx', 'produtos_created_by_fk_idx', 'lotes_created_by_fk_idx', 'pere_itens_created_by_fk_idx', 'pere_regs_created_by_fk_idx', 'solicitacoes_exclusao_revisor_id_fk_idx']) {
    assert.match(foreignKeyIndexes, new RegExp('create index if not exists ' + index));
  }
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

test('fila offline repete as RPCs originais e migration permite retry idempotente por ID/loja/autoria/payload', () => {
  assert.match(app, /SYNC\.filaRegistros/);
  assert.match(app, /function processarFilaRegistros\(loja\)/);
  assert.match(app, /return processarFilaRegistros\(loja\)\.then/);
  assert.match(app, /filaTemRegistro\('lote',l\.id,loja\)/);
  assert.match(app, /filaTemRegistro\('perecivel',r\.id,loja\)/);
  assert.match(offlineRpcMigration, /pg_advisory_xact_lock/);
  assert.match(offlineRpcMigration, /v_exist\.loja_id=p_loja_id/);
  assert.match(offlineRpcMigration, /v_exist\.created_by=auth\.uid\(\)/);
  assert.match(offlineRpcMigration, /v_exist\.setor=p_setor/);
  assert.match(offlineRpcMigration, /Identificador de lote já utilizado por outro registro/);
  assert.match(offlineRpcMigration, /Identificador perecível já utilizado por outro registro/);
  assert.match(offlineRpcMigration, /revoke all on function public\.registrar_lote/);
  assert.match(offlineRpcMigration, /revoke all on function public\.registrar_perecivel/);
});

test('RPCs exigem setor válido, mas trigger aceita NULL de clientes legados durante rollout', () => {
  assert.match(migration, /if p_setor is null or p_setor not in \('Açougue','Laticínios','Padaria','Salgados','FLV','Mercearia'\)/);
  assert.match(migration, /if new\.setor is not null and new\.setor not in \('Açougue','Laticínios','Padaria','Salgados','FLV','Mercearia'\)/);
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

test('limpar notificações é remoção lógica do próprio destinatário (não apaga a linha nem quebra a deduplicação)', () => {
  const m = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261110010000_notificacoes_remocao_logica.sql'), 'utf8');
  assert.match(m, /alter table public\.notificacoes add column if not exists removida_em timestamptz/);
  assert.match(m, /grant select,update\(lida_em,removida_em\) on public\.notificacoes to authenticated/);
  assert.doesNotMatch(m, /grant[^;]*delete[^;]*notificacoes[^;]*to authenticated/i, 'usuário comum não ganha DELETE');
  assert.doesNotMatch(m, /drop policy|disable row level security/i, 'políticas existentes são preservadas');
  assert.match(app, /removida_em=is\.null/);
});

test('troca de senha voluntária passa pela função do servidor, que confere a senha atual e aplica validarSenha', () => {
  const fn = fs.readFileSync(path.join(__dirname, '../supabase/functions/gerir-usuarios/index.ts'), 'utf8');
  const bloco = fn.match(/if \(acao === "trocar_senha"\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(bloco, 'ação trocar_senha existe');
  assert.match(bloco[1], /grant_type=password/, 'confere a senha atual no Auth');
  assert.match(bloco[1], /validarSenha\(senha, usuario\)/);
  assert.match(bloco[1], /updateUserById\(caller\.id, \{ password: senha \}\)/, 'só altera a própria conta');
  assert.match(bloco[1], /audit\("trocou_senha"/);
  assert.match(app, /acao:'trocar_senha'/);
  assert.doesNotMatch(app, /service_role|SERVICE_ROLE/);
});
