const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261109000000_area_operador_compartilhamento_alertas.sql'), 'utf8');
const offlineRpcMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261109123000_offline_rpc_idempotency.sql'), 'utf8');
const rolesMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261108130000_matriz_papeis_ownership_rls.sql'), 'utf8');
const adminCatalogMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261110150000_admin_catalog_soft_delete.sql'), 'utf8');
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

test('inativação do catálogo é lógica, replicável, reversível e autorizada no banco só para admin', () => {
  assert.match(adminCatalogMigration, /alter table public\.catalogo\s+add column if not exists deleted_at timestamptz/i);
  assert.match(adminCatalogMigration, /private\.meu_papel\(\) is distinct from 'admin'/i);
  assert.match(adminCatalogMigration, /create trigger catalogo_tombstone_guard\s+before insert or update on public\.catalogo/i);
  assert.match(adminCatalogMigration, /drop policy if exists catalogo_del_admin on public\.catalogo/i);
  assert.match(adminCatalogMigration, /revoke delete on public\.catalogo from public, anon, authenticated/i);
  assert.match(app, /deleted_at=is\.null/);
  assert.match(app, /function catalogoPull\(\)/);
  assert.match(app, /row\.deleted_at/);
  assert.match(app, /data-catalogo-inativar/);
  assert.match(app, /data-catalogo-restaurar/);
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

test('alertas de validade são gerados diariamente pelo agendador do banco, sem segredo embutido', () => {
  const m = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261110020000_agendar_alertas_validade.sql'), 'utf8');
  assert.match(m, /create extension if not exists pg_cron/);
  assert.match(m, /cron\.schedule\(\s*'gerar-alertas-validade-diario',\s*'0 9 \* \* \*',\s*\$\$select public\.gerar_alertas_validade\(\)\$\$/);
  // a chamada é local ao banco: nenhuma requisição HTTP, cabeçalho de segredo ou token na migration
  assert.doesNotMatch(m, /net\.http_post|x-alertas-cron-secret|Bearer|eyJ/);
});

test('agendador diário dispara a função alertas (push) lendo endereço, chave e segredo do Vault', () => {
  const m = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261110030000_agendador_dispara_push.sql'), 'utf8');
  const sql = m.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.match(sql, /cron\.schedule\(\s*'gerar-alertas-validade-diario',\s*'0 9 \* \* \*'/, 'mesmo job e horário (substitui o anterior)');
  assert.match(sql, /net\.http_post\(/);
  assert.match(sql, /"action":"dispatch"/);
  for (const nome of ['alertas_function_url', 'alertas_anon_key', 'alertas_cron_secret']) assert.match(sql, new RegExp(`vault\\.decrypted_secrets where name = '${nome}'`), nome);
  assert.match(sql, /'x-alertas-cron-secret', \(select decrypted_secret/);
  // nada sensível nem específico do projeto no arquivo
  assert.doesNotMatch(sql, /eyJ|sb_publishable_|sb_secret_|supabase\.co|[0-9a-f]{40,}/);
});

test('perfis de escopo global recebem avisos de todas as lojas; ninguém lê notificação de outra pessoa', () => {
  const m = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261110040000_alertas_escopo_global.sql'), 'utf8');
  assert.match(m, /select lm\.user_id, lm\.loja_id from public\.loja_membros lm\s+union[\s\S]*from public\.perfis p cross join public\.lojas lo\s+where p\.papel in \('analista','gerente','admin'\)/);
  assert.match(m, /on conflict\(user_id,dedupe_key\) do nothing/, 'deduplicação preservada');
  assert.match(m, /<> 'service_role' then raise exception/, 'continua restrita ao service_role');
  assert.match(m, /revoke all on function public\.gerar_alertas_validade\(\) from public,anon,authenticated/);
  for (const pol of ['notificacoes_sel_own_store', 'notificacoes_upd_own_store']) {
    const bloco = m.match(new RegExp('alter policy ' + pol + '[\\s\\S]*?;'))[0];
    assert.match(bloco, /user_id=\(select auth\.uid\(\)\) and \(private\.membro_da\(loja_id\) or private\.tem_escopo_global\(\)\)/, pol);
  }
  assert.doesNotMatch(m, /drop policy|disable row level security|to anon/i);
  // o corpo da função só difere da versão anterior no trecho dos destinatários
  const corpo = s => s.slice(s.indexOf('create or replace function public.gerar_alertas_validade()'), s.indexOf('$$;', s.indexOf('create or replace function public.gerar_alertas_validade()')));
  const antes = corpo(migration).split('\n'), depois = corpo(m).split('\n');
  assert.deepEqual(antes.filter(l => !depois.includes(l)), ['    from candidatos c join public.loja_membros m on m.loja_id=c.loja_id']);
  assert.match(edge, /PAPEIS_GLOBAIS = \["analista", "gerente", "admin"\]/);
  assert.match(edge, /if \(!error && data\) return true;[\s\S]*PAPEIS_GLOBAIS\.includes\(perfil\.papel\)\) return false;[\s\S]*from\("lojas"\)/, 'global só em loja existente');
});
