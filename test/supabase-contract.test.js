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
const internalPushMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261110170000_push_interno_autorizado.sql'), 'utf8');
const calendarMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261110180000_google_calendar.sql'), 'utf8');
const calendarEdge = fs.readFileSync(path.join(root, 'supabase/functions/google-calendar/index.ts'), 'utf8');
const calendarLogic = fs.readFileSync(path.join(root, 'supabase/functions/google-calendar/sync-logic.mjs'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/alertas/index.ts'), 'utf8');
const cronAlertsFix = fs.readFileSync(path.join(root, 'supabase/migrations/20261111173500_gerar_alertas_via_edge_function.sql'), 'utf8');
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
  assert.match(app, /if\(acao==='registrar'\)return \['operador','assistente','analista','gerente'\]\.includes\(p\)&&temPermissao\('registrar'\);/);
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
  assert.match(app, /\/rest\/v1\/notificacoes\?select=id,tipo,titulo,mensagem,payload,criado,lida_em&or=\(loja_id\.eq\.'\+encodeURIComponent\(SESS\.lojaId\)\+',tipo\.eq\.sistema_personalizado\)/);
  assert.match(migration, /create table if not exists public\.notificacoes/);
  assert.match(migration, /create policy notificacoes_sel_own_store[\s\S]*user_id=\(select auth\.uid\(\)\)[\s\S]*private\.membro_da\(loja_id\)/);
  assert.match(migration, /create policy notificacoes_upd_own_store[\s\S]*user_id=\(select auth\.uid\(\)\)/);
  assert.match(migration, /coalesce\(auth\.role\(\),''\) <> 'service_role'/);
});

test('janela compartilhada e autorização de Push interno exigem gerente/admin no banco', () => {
  assert.match(internalPushMigration, /add column if not exists push_interno boolean not null default false/);
  assert.match(internalPushMigration, /new\.dias is distinct from old\.dias or coalesce\(new\.push_interno,false\) is distinct from coalesce\(old\.push_interno,false\)/);
  assert.match(internalPushMigration, /coalesce\(v_papel,''\) not in \('admin','gerente'\)/);
  assert.match(internalPushMigration, /Somente gerente ou administrador pode definir alertas internos da loja/);
  assert.match(internalPushMigration, /private\.validar_ajustes_alertas_gerenciais/);
  assert.match(internalPushMigration, /from public\.notificacoes n join public\.ajustes a[\s\S]*a\.push_interno[\s\S]*n\.criado>=a\.push_interno_desde/);
  assert.match(internalPushMigration, /unique references public\.notificacoes\(id\)/);
  assert.match(edge, /preparar_alertas_push_internos/);
  assert.match(edge, /reivindicar_alertas_push_internos/);
  assert.match(edge, /registrar_resultado_alerta_push_interno/);
  assert.match(edge, /push_kind: "personal"/);
  assert.match(edge, /push_kind: "internal"/);
});

test('PWA publica service worker, manifest e ícones necessários', () => {
  assert.match(app, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(app, /serviceWorker\.register\('\.\/service-worker\.js'\)/);
  assert.match(build, /manifest\.webmanifest.*service-worker\.js.*logo\.jpg.*pwa-icon-192\.png.*pwa-icon-512\.png/);
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

test('migration inicial histórica agenda alertas por SQL sem embutir segredo', () => {
  const m = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261110020000_agendar_alertas_validade.sql'), 'utf8');
  assert.match(m, /create extension if not exists pg_cron/);
  assert.match(m, /cron\.schedule\(\s*'gerar-alertas-validade-diario',\s*'0 9 \* \* \*',\s*\$\$select public\.gerar_alertas_validade\(\)\$\$/);
  // a chamada é local ao banco: nenhuma requisição HTTP, cabeçalho de segredo ou token na migration
  assert.doesNotMatch(m, /net\.http_post|x-alertas-cron-secret|Bearer|eyJ/);
});

test('migration histórica do dispatcher lê endereço, chave e segredo do Vault', () => {
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
  assert.match(m, /grant execute on function public\.gerar_alertas_validade\(\) to service_role/);
  for (const pol of ['notificacoes_sel_own_store', 'notificacoes_upd_own_store']) {
    const bloco = m.match(new RegExp('alter policy ' + pol + '[\\s\\S]*?;'))[0];
    assert.match(bloco, /user_id=\(select auth\.uid\(\)\) and \(private\.membro_da\(loja_id\) or private\.tem_escopo_global\(\)\)/, pol);
  }
  assert.doesNotMatch(m, /drop policy|disable row level security|to anon/i);
  // o corpo da função só difere da versão anterior no trecho dos destinatários
  const corpo = s => s.slice(s.indexOf('create or replace function public.gerar_alertas_validade()'), s.indexOf('$$;', s.indexOf('create or replace function public.gerar_alertas_validade()')));
  const antes = corpo(migration).split('\n'), depois = corpo(m).split('\n');
  assert.deepEqual(antes.filter(l => !depois.includes(l)), ['    from candidatos c join public.loja_membros m on m.loja_id=c.loja_id']);
  assert.match(edge, /if \(!error && data\) return true;[\s\S]*rpc\("papel_tem_permissao", \{ p_papel: perfil\.papel, p_permissao: "avisos_todas_lojas" \}\)[\s\S]*global !== true\) return false;[\s\S]*from\("lojas"\)/, 'global só com permissão e em loja existente');
});

test('regras pessoais isoladas, timezone validado, outbox deduplicada e RPCs privadas', () => {
  const m = fs.readFileSync(path.join(root, 'supabase/migrations/20261110160000_alertas_regras_pessoais.sql'), 'utf8');
  assert.match(m, /create extension if not exists pg_cron/);
  assert.match(m, /create extension if not exists pg_net/);
  assert.match(m, /create table public\.alertas_regras/);
  assert.match(m, /dias between 1 and 365/);
  assert.match(m, /default 'America\/Sao_Paulo'/);
  assert.match(m, /pg_catalog\.pg_timezone_names/);
  assert.match(m, /unique\(user_id,dias,hora_local,fuso\)/);
  assert.match(m, /enable row level security/);
  assert.match(m, /using \(user_id=\(select auth\.uid\(\)\)\)/);
  assert.match(m, /registro_id text not null/, 'IDs operacionais de lotes/perecíveis são text');
  assert.match(m, /unique\(regra_id,user_id,loja_id,registro_id,validade,data_local\)/);
  assert.match(m, /skip locked/);
  assert.match(m, /lease_until/);
  assert.match(m, /o\.data_local<>\(now\(\) at time zone ar\.fuso\)::date/, 'eventos atrasados/desativados não disparam em outra data');
  assert.match(m, /f\.validade < \(now\(\) at time zone ar\.fuso\)::date/, 'a mensagem usa data civil do fuso pessoal');
  assert.match(m, /make_interval\(secs=>least\(3600/);
  assert.match(m, /attempts>=8 then 'dead'/, 'backoff termina em estado terminal após oito tentativas');
  assert.match(m, /revoke all on function public\.preparar_alertas_push\(\) from public,anon,authenticated/);
  assert.match(m, /grant execute on function public\.reivindicar_alertas_push\(integer\) to service_role/);
});

test('cron diário corrigido usa Edge Function protegida e mantém dispatcher minutely separado', () => {
  const m = fs.readFileSync(path.join(root, 'supabase/migrations/20261110160000_alertas_regras_pessoais.sql'), 'utf8');
  assert.match(m, /where jobname='gerar-alertas-validade-diario' loop perform cron\.unschedule\(j\.jobid\)/);
  assert.match(m, /cron\.schedule\('gerar-alertas-validade-diario','0 9 \* \* \*',\$\$select public\.gerar_alertas_validade\(\)\$\$\)/);
  assert.match(m, /where jobname='despachar-alertas-push-minutely' loop perform cron\.unschedule\(j\.jobid\)/);
  assert.match(m, /cron\.schedule\('despachar-alertas-push-minutely','\* \* \* \* \*'/);
  assert.doesNotMatch(m, /create or replace function public\.gerar_alertas_validade\(\)/, 'a migration não redefine a geração interna');
  assert.match(m, /p\.papel in \('analista','gerente','admin'\)/);
  const fix = cronAlertsFix.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.match(fix, /where jobname = 'gerar-alertas-validade-diario'[\s\S]*?loop\s+perform cron\.unschedule\(j\.jobid\)/);
  assert.match(fix, /cron\.schedule\(\s*'gerar-alertas-validade-diario',\s*'0 9 \* \* \*'/);
  assert.match(fix, /net\.http_post\(/);
  assert.match(fix, /"action":"generate-alerts"/);
  assert.doesNotMatch(fix, /select\s+public\.gerar_alertas_validade\(\)/, 'pg_cron não invoca diretamente RPC que exige JWT service_role');
  for (const nome of ['alertas_function_url', 'alertas_anon_key', 'alertas_cron_secret'])
    assert.match(fix, new RegExp(`vault\\.decrypted_secrets where name = '${nome}'`), nome);
  assert.match(fix, /'x-alertas-cron-secret',\s*\(select decrypted_secret/);
  assert.match(fix, /'Authorization', 'Bearer ' \|\| \(select decrypted_secret from vault\.decrypted_secrets where name = 'alertas_anon_key'\)/, 'gateway JWT continua habilitado');
  const generation = edge.match(/if \(action === "generate-alerts"\) \{([\s\S]*?)\n  \}/);
  assert.ok(generation, 'ação server-side de geração existe');
  assert.match(generation[1], /cronAuthorized\(req\)/, 'rota exige segredo de cron');
  assert.match(generation[1], /admin\.rpc\("gerar_alertas_validade"\)/, 'RPC roda pelo cliente server-side service_role');
  assert.match(generation[1], /return json\(\{ ok: true, gerados: Array\.isArray\(data\) \? data\.length : 0 \}\)/, 'retorno não expõe dados de destinatários');
  assert.match(edge, /function cronAuthorized\(req: Request\): boolean/);
  assert.match(edge, /return !!expected && constantTimeEqual\(supplied, expected\)/, 'segredo só é aceito com comparação constante');
  assert.match(edge, /const serviceKey = env\("SUPABASE_SERVICE_ROLE_KEY"\)/, 'chave de serviço permanece apenas no backend');
});

test('dispatch processa outboxes pessoal e interna e mantém segredo, VAPID e subscriptions', () => {
  assert.match(edge, /admin\.rpc\("preparar_alertas_push"\)/);
  assert.match(edge, /admin\.rpc\("preparar_alertas_push_internos"\)/);
  assert.match(edge, /admin\.rpc\("reivindicar_alertas_push"/);
  assert.match(edge, /admin\.rpc\(rpc, \{ p_id: notification\.id/);
  assert.match(edge, /registrar_resultado_alerta_push_interno/);
  const dispatch = edge.match(/if \(action === "dispatch"\) \{([\s\S]*?)\n  \}\n\n  \/\/ Push de um alerta personalizado/);
  assert.ok(dispatch, 'bloco de dispatch continua independente da geração diária');
  assert.doesNotMatch(dispatch[1], /gerar_alertas_validade/);
  assert.match(edge, /ALERTAS_CRON_SECRET/);
  assert.match(dispatch[1], /cronAuthorized\(req\)/, 'dispatcher continua exigindo o segredo de cron');
  assert.match(edge, /VAPID_PRIVATE_KEY/);
  assert.match(edge, /eq\("owner_id", notification\.user_id\)/);
  assert.match(edge, /action !== "subscribe" && action !== "unsubscribe"/);
});

test('Google Calendar protege credenciais, OAuth states e mapping por RLS/grants service_role', () => {
  for (const table of ['google_calendar_connections', 'google_calendar_oauth_states', 'google_calendar_event_map']) {
    const block = calendarMigration.match(new RegExp(`create table public\\.${table}([\\s\\S]*?);[\\s\\S]*?alter table public\\.${table} enable row level security;[\\s\\S]*?revoke all on public\\.${table} from public, anon, authenticated;[\\s\\S]*?grant all on public\\.${table} to service_role;`));
    assert.ok(block, `${table} com RLS e acesso exclusivo ao service_role`);
  }
  assert.match(calendarMigration, /refresh_token_ciphertext/);
  assert.doesNotMatch(calendarMigration, /grant[^;]*to authenticated/i);
});

test('OAuth Calendar consome state uma única vez, exige expiração e guarda somente hash', () => {
  assert.match(calendarMigration, /state_hash text primary key/);
  assert.match(calendarMigration, /consumed_at is null and expires_at>now\(\)/);
  assert.match(calendarMigration, /update public\.google_calendar_oauth_states set consumed_at=now\(\)/);
  assert.match(calendarEdge, /expires_at: new Date\(Date\.now\(\) \+ 10 \* 60_000\)/);
  assert.match(calendarEdge, /p_hash: await sha\(state\)/);
  assert.match(calendarEdge, /state_hash: await sha\(state\)/);
});

test('OAuth Google usa scope restrito, callback fixo, offline access e JWT obrigatório em todas as ações POST', () => {
  assert.match(calendarEdge, /calendar\.events\.owned/);
  assert.match(calendarEdge, /access_type: "offline"/);
  assert.match(calendarEdge, /https:\/\/jottacostta\.github\.io\/validade\//);
  assert.match(calendarEdge, /admin\.auth\.getUser\(token\)/);
  assert.match(calendarEdge, /const user = await userFromRequest\(req\)/);
  assert.match(calendarEdge, /\["status", "authorize", "sync", "disconnect"\]/);
  assert.match(calendarEdge, /GOOGLE_CALENDAR_REDIRECT_URI/);
  assert.match(calendarEdge, /Response\.redirect/);
});

test('refresh token é cifrado AES-GCM com chave runtime; escopo de usuário deriva exclusivamente do JWT', () => {
  assert.match(calendarEdge, /AES-GCM/);
  assert.match(calendarEdge, /GOOGLE_CALENDAR_TOKEN_KEY/);
  assert.match(calendarEdge, /raw\.length !== 32/);
  assert.match(calendarEdge, /await encrypt\(token\.refresh_token\)/);
  assert.match(calendarEdge, /eq\("user_id", user\.id\)/);
  assert.doesNotMatch(calendarEdge, /console\.(log|error|warn)/);
  assert.doesNotMatch(calendarEdge, /JSON\.stringify\([^\n]*refresh_token/);
});

test('refresh revogado remove a conexão e solicita nova autorização sem expor erro/token do Google', () => {
  assert.match(calendarLogic, /grantType === "refresh_token" && providerError === "invalid_grant"/);
  assert.match(calendarEdge, /error\.message === "refresh_token_revoked"/);
  assert.match(calendarEdge, /from\("google_calendar_connections"\)\.delete\(\)\.eq\("user_id", user\.id\)/);
  assert.match(calendarEdge, /code: "refresh_token_revoked", connected: false }, 409/);
  assert.match(app, /r\.status===409&&r\.dados&&r\.dados\.code==='refresh_token_revoked'/);
  assert.match(app, /A autorização do Google expirou ou foi revogada\. Reconecte o Calendar\./);
  assert.doesNotMatch(calendarEdge, /console\.(log|error|warn)/);
});

test('projeção Calendar aplica loja_membros/perfis globais, soft delete, janela e fuso da regra', () => {
  assert.match(calendarMigration, /l\.deleted_at is null and l\.val is not null/);
  assert.match(calendarMigration, /r\.deleted_at is null and r\.val is not null/);
  assert.match(calendarMigration, /lm\.user_id=p_user and lm\.loja_id=f\.loja_id/);
  assert.match(calendarMigration, /p\.papel in \('analista','gerente','admin'\)/);
  assert.match(calendarMigration, /ar\.user_id=p_user and ar\.ativo/);
  assert.match(calendarMigration, /between \(now\(\) at time zone ar\.fuso\)::date and \(\(now\(\) at time zone ar\.fuso\)::date\+365\)/);
  assert.match(calendarMigration, /d\.inicio,d\.inicio\+interval '15 minutes',d\.fuso/);
  assert.match(calendarEdge, /dateTime\(row\.start_at, row\.time_zone\)/);
});

test('eventos Calendar têm ID determinístico, hash, mapping sem FK destrutiva e cancelam apenas futuros', () => {
  assert.match(calendarMigration, /substr\(encode\(public\.digest\([\s\S]*?,1,32\)/);
  assert.match(calendarMigration, /primary key \(user_id,dedupe_key\)/);
  assert.match(calendarMigration, /preservar tombstones até o cancelamento remoto/);
  assert.match(calendarEdge, /reconciliarEventoCalendar\(/);
  assert.match(calendarEdge, /payloadIgual: activePrior\?\.payload_hash === payloadHash/);
  assert.match(calendarLogic, /response\.status === 409/);
  assert.match(calendarLogic, /eventoAusente\(response\)/);
  assert.match(calendarEdge, /status: "cancelled".*eq\("status", "active"\)/);
  assert.match(calendarEdge, /const event = \{ summary: row\.title/);
  assert.match(calendarEdge, /"POST", "https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events"/);
  assert.match(calendarLogic, /response\.status === 409/);
  assert.match(calendarEdge, /prior\.status === "active" && !desiredKeys\.has\(key\) && new Date\(prior\.start_at\)\.getTime\(\) > Date\.now\(\)/);
  assert.match(calendarEdge, /Math\.min\(5, items\.length\)/);
  assert.match(calendarEdge, /"DELETE"/);
});

test('correção de nome do catálogo: solicitação com avaliação e trava no banco', () => {
  const m = fs.readFileSync(path.join(root, 'supabase/migrations/20261111050000_correcao_nome_catalogo.sql'), 'utf8');
  assert.match(m, /create table if not exists public\.solicitacoes_nome/);
  assert.match(m, /alter table public\.solicitacoes_nome enable row level security/);
  assert.doesNotMatch(m, /grant[^;]*\b(insert|update|delete)\b[^;]*on public\.solicitacoes_nome/i, 'escrita só pelas funções');
  for (const f of ['solicitar_correcao_nome', 'revisar_correcao_nome']) {
    const corpo = m.slice(m.indexOf('function public.' + f));
    assert.match(corpo, /security definer\s+set search_path\s*=\s*''/);
    assert.match(corpo, /auth\.uid\(\) is null/);
    assert.match(m, new RegExp('revoke all on function public\\.' + f + '\\([^)]*\\) from public, ?anon'));
  }
  const revisar = m.slice(m.indexOf('function public.revisar_correcao_nome'));
  assert.match(revisar, /not in \('gerente','admin'\)/, 'só gerente e administrador avaliam');
  assert.match(revisar, /for update/);
  assert.match(revisar, /insert into public\.auditoria/);
  const trava = m.slice(m.indexOf('function private.proteger_nome_catalogo'), m.indexOf('create trigger catalogo_nome_guard'));
  assert.match(trava, /new\.nome is distinct from old\.nome/);
  assert.match(trava, /not in \('gerente','admin'\)/);
  assert.match(trava, /new\.nome := old\.nome/, 'envios de outros perfis preservam o nome em vez de falhar');
  assert.match(m, /create trigger catalogo_nome_guard\s+before update on public\.catalogo/);
  assert.match(app, /rpc\/solicitar_correcao_nome/);
  assert.match(app, /rpc\/revisar_correcao_nome/);
});

test('perfis de acesso: permissões por papel gravadas e validadas no banco', () => {
  const m = fs.readFileSync(path.join(root, 'supabase/migrations/20261111070000_perfis_de_acesso.sql'), 'utf8');
  assert.match(m, /create table if not exists public\.papel_permissoes/);
  assert.match(m, /check \(papel in \('operador','assistente','analista','gerente'\)\)/, 'administrador não é editável');
  assert.match(m, /alter table public\.papel_permissoes enable row level security/);
  assert.doesNotMatch(m, /grant[^;]*\b(insert|update|delete)\b[^;]*on public\.papel_permissoes/i);
  const definir = m.slice(m.indexOf('function public.definir_permissao_papel'));
  assert.match(definir, /security definer\s+set search_path\s*=\s*''/);
  assert.match(definir, /auth\.uid\(\) is null/);
  assert.match(definir, /is distinct from 'admin'/, 'só administrador define permissões');
  assert.match(definir, /insert into public\.auditoria/);
  assert.match(m, /revoke all on function public\.definir_permissao_papel\(text,text,boolean\) from public, ?anon/);
  const tem = m.slice(m.indexOf('function private.tem_permissao'), m.indexOf('function public.definir_permissao_papel'));
  assert.match(tem, /v_papel = 'admin' then return true/);
  assert.match(tem, /from public\.papel_permissoes/);
  assert.match(m, /private\.tem_permissao\('nome_editar'\)/, 'edição e avaliação de nome obedecem à permissão');
  assert.match(m, /private\.tem_permissao\('nome_solicitar'\)/);
  // a lista de permissões do app e a do banco são a mesma
  const noApp = [...app.matchAll(/\{id:'([a-z_]+)',grupo:'(?:basica|especial)'/g)].map(x => x[1]).sort();
  const m3 = fs.readFileSync(path.join(root, 'supabase/migrations/20261111140000_alertas_personalizados.sql'), 'utf8');
  const noBanco = [...m3.slice(m3.indexOf('function private.permissao_padrao'), m3.indexOf('definir_permissao_papel')).matchAll(/\('([a-z_]+)',\s*array\[/g)].map(x => x[1]).sort();
  assert.ok(noApp.length >= 10); assert.deepEqual(noApp, noBanco);
  assert.match(app, /rpc\/definir_permissao_papel/);
});

test('perfis de acesso etapa 2: registros e exclusões obedecem às permissões no banco', () => {
  const m = fs.readFileSync(path.join(root, 'supabase/migrations/20261111080000_permissoes_registros_exclusoes.sql'), 'utf8');
  for (const perm of ['registrar', 'editar_proprios', 'registros_editar_outros', 'solicitar_exclusao', 'exclusoes_aprovar']) {
    assert.match(m, new RegExp("private\\.tem_permissao\\('" + perm + "'\\)"), perm + ' validada no banco');
    assert.match(app, new RegExp("\\{id:'" + perm + "',[^}]*servidor:true\\}"), perm + ' liberada na tela');
  }
  assert.match(m, /array\['produtos','lotes','pere_itens','pere_regs'\]/);
  assert.match(m, /private\.tem_escopo_global\(\) or private\.membro_da\(loja_id\)/, 'alcance por loja preservado');
  assert.match(m, /created_by = \(select auth\.uid\(\)\) and \(select private\.tem_permissao\('editar_proprios'\)\)/);
  assert.equal([...m.matchAll(/trecho de (papel|acesso) não encontrado/g)].length, 2, 'falha inteira se a função mudou');
});

test('perfis de acesso etapa 3: áreas administrativas obedecem às permissões e nada fica travado', () => {
  const m = fs.readFileSync(path.join(root, 'supabase/migrations/20261111090000_permissoes_areas_administrativas.sql'), 'utf8');
  for (const perm of ['auditoria_ver', 'catalogo_gerenciar', 'alertas_loja_configurar', 'lojas_gerenciar', 'usuarios_gerenciar', 'avisos_todas_lojas'])
    assert.match(m, new RegExp("'" + perm + "'"), perm + ' validada no banco');
  const fn = m.slice(m.indexOf('function public.papel_tem_permissao'), m.indexOf('-- Auditoria'));
  assert.match(fn, /security definer\s+set search_path = ''/);
  assert.match(fn, /when p_papel = 'admin' then true/);
  assert.match(fn, /revoke all on function public\.papel_tem_permissao\(text,text\) from public, anon/);
  assert.equal([...m.matchAll(/não encontrad[oa]/g)].length, 4, 'falha inteira se alguma função mudou');
  const lista = app.slice(app.indexOf('var PERMISSOES=['), app.indexOf('function permissaoDef'));
  assert.equal([...lista.matchAll(/\{id:'/g)].length, 17);
  assert.equal([...lista.matchAll(/teto:TODOS4,servidor:true\}/g)].length, 17, 'todas as permissões podem ser concedidas a qualquer perfil');
  const gerir = fs.readFileSync(path.join(root, 'supabase/functions/gerir-usuarios/index.ts'), 'utf8');
  assert.match(gerir, /rpc\("papel_tem_permissao", \{ p_papel: papelCaller, p_permissao: "usuarios_gerenciar" \}\)/);
  assert.match(gerir, /if \(permErr\) return json\(/, 'falha ao consultar permissão nega o acesso');
});

test('aprovar exclusão de registro já removido conclui a solicitação em vez de travar', () => {
  const m = fs.readFileSync(path.join(root, 'supabase/migrations/20261111130000_aprovar_exclusao_ja_removida.sql'), 'utf8');
  assert.match(m, /if not found then v_ja_removido := true; end if;/);
  assert.match(m, /v_ja_removido boolean := false/);
  assert.match(m, /'ja_removido',v_ja_removido/);
  assert.equal([...m.matchAll(/não encontrad[oa]'; end if;\n/g)].length, 3, 'falha inteira se a função mudou');
});

test('alertas personalizados: envio validado no banco e push só pelo remetente', () => {
  const m = fs.readFileSync(path.join(root, 'supabase/migrations/20261111140000_alertas_personalizados.sql'), 'utf8');
  const fn = m.slice(m.indexOf('function public.enviar_alerta_personalizado'));
  assert.match(fn, /security definer\s+set search_path = ''/);
  assert.match(fn, /auth\.uid\(\) is null/);
  assert.match(fn, /private\.tem_permissao\('alertas_enviar'\)/);
  assert.match(fn, /private\.tem_escopo_global\(\)/, 'envio para todas as lojas exige alcance global');
  assert.match(fn, /private\.membro_da\(p_loja_id\)/);
  assert.match(fn, /insert into public\.auditoria/);
  assert.match(m, /revoke all on function public\.enviar_alerta_personalizado\(text,text,uuid,text\) from public, ?anon/);
  assert.match(m, /\('alertas_enviar',\s*array\[\]::text\[\]\)/, 'por padrão só o Administrador envia');
  assert.match(app, /\{id:'alertas_enviar',grupo:'especial'/);
  const edge = fs.readFileSync(path.join(root, 'supabase/functions/alertas/index.ts'), 'utf8');
  assert.match(edge, /action === "custom-push"/);
  assert.match(edge, /\.eq\("payload->>remetente_id", user\.id\)/, 'só o remetente dispara o push do próprio envio');
});

test('PWA instalável: manifest com ícones 192 e 512 e service worker registrado ao abrir', () => {
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.webmanifest'), 'utf8'));
  const tamanhos = mf.icons.filter(i => i.type === 'image/png').map(i => i.sizes);
  assert.ok(tamanhos.includes('192x192') && tamanhos.includes('512x512'), 'Chrome/Android exigem 192 e 512');
  assert.equal(mf.display, 'standalone'); assert.ok(mf.name && mf.short_name && mf.start_url);
  for (const i of mf.icons) assert.ok(fs.existsSync(path.join(root, 'src', i.src)), i.src + ' existe');
  const build = fs.readFileSync(path.join(root, 'build.js'), 'utf8');
  assert.match(build, /pwa-icon-512\.png/, 'ícone 512 é copiado para dist');
  assert.match(app, /function registrarServiceWorker\(\)/);
  assert.match(app, /addEventListener\('beforeinstallprompt'/);
});

test('alerta personalizado: remetente recebe a própria cópia e regras não dependem do localStorage', () => {
  const m = fs.readFileSync(path.join(root, 'supabase/migrations/20261111150000_alerta_personalizado_inclui_remetente.sql'), 'utf8');
  assert.match(m, /and d\\\.user_id <> auth\\\.uid\\\(\\\)/);
  assert.match(m, /exclusão do remetente não encontrada/);
  assert.match(app, /var regrasMem=\{\};/);
  assert.match(app, /k\.indexOf\('validade_alertas_regras_'\)!==0\)ks\.push\(k\)/, 'limpeza de sobras preserva as regras');
});
