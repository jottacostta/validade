const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261115075000_checklist_diario_acougue.sql'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
const checklistPath = path.join(root, 'src/checklist.js');
const checklist = fs.existsSync(checklistPath) ? fs.readFileSync(checklistPath, 'utf8') : '';
const frontend = `${checklist}\n${app}`;

function functionBody(name) {
  const start = migration.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public|private)\\.${name}\\s*\\(`, 'i'));
  assert.notEqual(start, -1, `função ${name} deve existir na migration`);
  const rest = migration.slice(start);
  const next = rest.slice(1).search(/\ncreate\s+(?:or\s+replace\s+)?function\s+/i);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test('template canônico do Açougue tem seis seções e exatamente 23 itens', () => {
  const source = migration;
  const sections = [...source.matchAll(/['"](secao_[a-z0-9_]+)['"]/gi)].map(m => m[1]);
  const items = [...source.matchAll(/['"](item_[a-z0-9_]+)['"]/gi)].map(m => m[1]);
  assert.equal(new Set(sections).size, 6, 'seis IDs de seção distintos');
  assert.equal(new Set(items).size, 23, '23 IDs de item distintos');
  assert.match(source, /Temperaturas|ilhas_c|temperatura/i, 'template inclui o item especial de temperaturas');
  assert.match(migration, /modelo_snapshot\s+jsonb/i, 'a ronda preserva snapshot do template');
});

test('assignment é por loja e há exatamente duas etapas designadas, sem papel global novo', () => {
  assert.match(migration, /create\s+table\s+public\.checklist_acessos[\s\S]*?loja_id[\s\S]*?user_id[\s\S]*?funcao\s+text[\s\S]*?\('executor','encarregado','subgerente'\)/i);
  assert.match(migration, /create\s+unique\s+index\s+checklist_acesso_unico_revisor[\s\S]*?funcao\s+in\s*\('encarregado','subgerente'\)/i,
    'há apenas uma atribuição ativa por etapa revisora e loja');
  assert.match(migration, /checklist_assinaturas[\s\S]*?etapa\s+text\s+not null\s+check\s*\(\s*etapa\s+in\s*\('encarregado','subgerente'\)\)/i);
  assert.doesNotMatch(migration, /alter\s+table\s+public\.perfis[\s\S]*?(?:add\s+column\s+.*papel|papel\s+in\s*\([^)]*(?:encarregado|subgerente))/i,
    'as etapas não são acrescentadas à matriz de papéis globais');
});

test('RLS e interface ocultam checklist para quem não está designado na loja', () => {
  assert.match(migration, /function\s+private\.checklist_designado\s*\([\s\S]*?auth\.uid\(\)\s+is\s+not\s+null[\s\S]*?join\s+public\.checklist_configuracoes[\s\S]*?a\.loja_id\s*=\s*p_loja_id[\s\S]*?a\.user_id\s*=\s*auth\.uid\(\)[\s\S]*?a\.ativo/i);
  assert.match(migration, /function\s+private\.checklist_designado[\s\S]*?join\s+public\.loja_membros\s+m\s+on\s+m\.loja_id\s*=\s*a\.loja_id\s+and\s+m\.user_id\s*=\s*a\.user_id/i,
    'revogar o vínculo à loja revoga imediatamente acesso, mesmo se o assignment antigo continuar');
  assert.match(migration, /create\s+policy\s+checklist_ronda_read[\s\S]*?private\.checklist_designado\(loja_id\)/i);
  assert.match(migration, /checklist_assinatura_read[\s\S]*?private\.checklist_designado\(r\.loja_id\)/i);
  assert.match(migration, /alter\s+table\s+public\.checklist_acessos\s+enable\s+row\s+level\s+security/i);
  assert.match(frontend, /checklist/i, 'app.html ou src/checklist.js integra a funcionalidade');
  assert.match(frontend, /checklist_designado|checklist_acessos|checklist_configuracoes|executores|designad/i,
    'a UI deriva elegibilidade de designação, não somente do papel global');
  assert.match(frontend, /hidden|display\s*[:=]\s*['"]?none|classList\.add\(['"]hidden|remove\(['"]checklist/i,
    'há ocultação explícita do app/nav para usuário sem acesso');
});

test('RPCs sensíveis usam auth.uid no servidor e validam Admin/assignment e membership', () => {
  const configure = functionBody('checklist_configurar_loja');
  const create = functionBody('checklist_criar_ronda');
  const save = functionBody('checklist_salvar_rascunho');
  const submit = functionBody('checklist_submeter_ronda');
  const sign = functionBody('checklist_assinar_ronda');
  for (const [name, body] of Object.entries({ configure, create, save, submit, sign })) {
    assert.match(body, /security\s+definer/i, `${name}: autorização executada no servidor`);
    assert.match(body, /auth\.uid\(\)/i, `${name}: identidade vem de auth.uid()`);
  }
  assert.match(configure, /private\.meu_papel\(\)\s+is\s+distinct\s+from\s+'admin'/i, 'configuração restrita a Admin');
  for (const body of [create, save, submit, sign]) assert.match(body, /private\.checklist_designado\(/i);
  assert.match(create, /checklist_acessos[\s\S]*?funcao\s*=\s*'executor'[\s\S]*?ativo/i);
  assert.match(sign, /checklist_acessos[\s\S]*?funcao\s*=\s*v_etapa[\s\S]*?ativo/i);
  for (const table of ['checklist_modelos', 'checklist_configuracoes', 'checklist_config_auditoria', 'checklist_acessos', 'checklist_rondas', 'checklist_assinaturas', 'checklist_eventos']) {
    assert.match(migration, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'), `${table}: RLS habilitada`);
  }
});

test('assinaturas são append-only, da versão atual, dual e vedadas a quem criou/executou', () => {
  assert.match(migration, /revoke\s+all\s+on\s+public\.checklist_modelos[\s\S]*?from\s+public,\s*anon,\s*authenticated/i,
    'revoga escrita direta nas tabelas de checklist');
  assert.match(migration, /grant\s+select\s+on\s+public\.checklist_modelos[\s\S]*?to\s+authenticated/i);
  assert.match(migration, /unique\s*\(\s*ronda_id\s*,\s*versao_conteudo\s*,\s*etapa\s*\)/i, 'uma assinatura por etapa/versão');
  const sign = functionBody('checklist_assinar_ronda');
  assert.match(sign, /versao_conteudo\s*,\s*etapa[\s\S]*?values\s*\(\s*r\.id\s*,\s*r\.versao_conteudo/i,
    'assinatura registra exatamente a versão corrente');
  assert.match(sign, /checklist_eventos[\s\S]*?user_id\s*=\s*auth\.uid\(\)[\s\S]*?acao\s*=\s*'rascunho_salvo'/i,
    'autor de rascunho não pode assinar');
  assert.match(sign, /v_a\s+and\s+v_b[\s\S]*?estado\s*=\s*'validada'/i, 'dual approval é necessária para validar');
  assert.match(sign, /for\s+update/i, 'revisões concorrentes são serializadas');
  assert.match(migration, /unique\s*\(\s*ronda_id\s*,\s*versao_conteudo\s*,\s*etapa\s*\)/i);
});

test('devolver exige motivo, mas observação do executor não é obrigatória', () => {
  const sign = functionBody('checklist_assinar_ronda');
  const save = functionBody('checklist_salvar_rascunho');
  assert.match(sign, /p_decisao\s*=\s*'devolvida'[\s\S]*?length\s*\(\s*btrim\s*\(\s*coalesce\s*\(\s*p_comentario\s*,\s*''\s*\)\s*\)\s*\)\s*<\s*3/i,
    'devolução sem motivo suficiente é rejeitada');
  assert.match(migration, /check\s*\(\s*\(\s*decisao\s*=\s*'devolvida'[\s\S]*?length\s*\(\s*btrim\s*\(\s*coalesce\s*\(\s*comentario\s*,\s*''\s*\)\s*\)\s*\)\s*>=\s*3/i);
  assert.doesNotMatch(save, /p_observacoes\s+is\s+(?:null|not\s+null)|nullif\s*\(\s*btrim\s*\(\s*p_observacoes/i,
    'observações podem ficar vazias ou nulas; não são requisito de salvamento');
});

test('rascunho parcial é permitido, mas submissão exige respostas e as duas leituras térmicas', () => {
  const save = functionBody('checklist_salvar_rascunho');
  const submit = functionBody('checklist_submeter_ronda');
  assert.match(save, /jsonb_typeof\(p_respostas\)\s+is\s+distinct\s+from\s+'object'/i);
  assert.match(save, /select\s+count\(\*\)\s+from\s+jsonb_object_keys\(p_respostas\)/i);
  assert.doesNotMatch(migration, /jsonb_object_length\s*\(/i, 'PostgreSQL não oferece jsonb_object_length');
  assert.match(save, /coalesce\(e\.value->>'resposta',''\)\s+not\s+in\s*\('','SIM','NÃO'\)/i, 'rascunho aceita item ainda sem resposta');
  assert.match(submit, /coalesce\(e\.value->>'resposta',''\)\s+not\s+in\s*\('SIM','NÃO'\)/i, 'não permite submeter itens vazios');
  assert.match(submit, /nullif\s*\(\s*btrim\s*\(\s*r\.respostas[\s\S]*?ilhas_c[\s\S]*?nullif\s*\(\s*btrim\s*\(\s*r\.respostas[\s\S]*?peixes_c/i);
});

test('estados, unicidade diária, versões e locks protegem concorrência', () => {
  assert.match(migration, /estado\s+text\s+not\s+null\s+default\s+'rascunho'\s+check\s*\(\s*estado\s+in\s*\('rascunho','submetida','devolvida','validada'\)/i);
  assert.match(migration, /unique\s*\(\s*loja_id\s*,\s*data_operacional\s*\)/i, 'uma ronda por loja/data');
  assert.match(migration, /unique\s*\(\s*ronda_id\s*,\s*versao_conteudo\s*,\s*etapa\s*\)/i, 'assinatura não duplica por versão/etapa');
  assert.match(functionBody('checklist_criar_ronda'), /on\s+conflict\s*\(\s*loja_id\s*,\s*data_operacional\s*\)\s*do\s+nothing/i);
  for (const name of ['checklist_criar_ronda', 'checklist_salvar_rascunho', 'checklist_submeter_ronda', 'checklist_assinar_ronda']) {
    assert.match(functionBody(name), /for\s+update/i, `${name}: lock de linha`);
  }
  assert.match(functionBody('checklist_salvar_rascunho'), /versao_conteudo\s*=\s*versao_conteudo\s*\+\s*1/i);
});

test('avisos e estados de segurança têm checks explícitos e RPC só é concedida a autenticados', () => {
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.checklist_configurar_loja\([\s\S]*?from\s+public,\s*anon/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.checklist_configurar_loja\([\s\S]*?to\s+authenticated/i);
  for (const message of ['Somente Admin configura o checklist', 'executor não designado', 'obrigatório']) assert.match(migration, new RegExp(message, 'i'));
  assert.match(migration, /aguardando_segunda_assinatura/i);
  assert.match(frontend, /aviso|alert|estado|rascunho|submetida|devolvida|validada/i,
    'UI apresenta estados/avisos do checklist');
});
