const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.html'),'utf8');
const edge=fs.readFileSync(path.join(__dirname,'../supabase/functions/gerir-usuarios/index.ts'),'utf8');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261108130000_matriz_papeis_ownership_rls.sql'),'utf8');

test('papel Gerente está presente na UI e no backend',()=>{
  assert.match(app,/gerente:'Gerente'/);
  assert.match(app,/value="gerente">Gerente/);
  assert.match(edge,/"gerente"/);
  assert.match(sql,/'gerente'/);
});

test('operador e assistente editam apenas registros próprios no RLS',()=>{
  assert.match(sql,/created_by = auth\.uid\(\)/);
  assert.match(app,/temPermissao\('registros_editar_outros'\)\|\|\(proprio&&temPermissao\('editar_proprios'\)\)/);
  assert.match(app,/\{id:'registros_editar_outros',grupo:'especial',titulo:'[^']+',padrao:\['analista','gerente'\]/);
  assert.match(app,/created_by===SESS\.uid/);
});

test('solicitação e revisão de exclusão passam por RPC',()=>{
  assert.match(app,/rpc\/solicitar_exclusao/);
  assert.match(app,/rpc\/revisar_solicitacao_exclusao/);
  assert.match(sql,/revisar_solicitacao_exclusao/);
});

test('exclusão de contas respeita permissão por perfil e escopo individual do gerente',()=>{
  assert.match(edge,/p_permissao: "usuarios_excluir"/);
  assert.match(edge,/if \(!podeExcluir\) return json\(/);
  assert.match(edge,/const podeEditar = ehAdmin \|\| gerenciaUsuarios;/);
  assert.match(edge,/const escopoTotal = ehAdmin \|\| ehAnalista;/);
  assert.match(edge,/Gerente não pode excluir usuário de loja fora do seu escopo/);
});

test('sync aplica tombstones recebidos para remover dados locais',()=>{
  assert.match(app,/if\(row\.deleted_at\)\{delete D\.prod\[ean\];return;\}/);
  assert.match(app,/if\(row\.deleted_at\)\{var existing=D\.prod/);
});

test('solicitações de exclusão ficam na fila offline e são reenviadas ao reconectar',()=>{
  assert.match(app,/SYNC\.pendingExclusoes/);
  assert.match(app,/window\.addEventListener\('online',function\(\)\{processarSolicitacoesOffline\(\);/);
  assert.match(app,/solicitante_id===SESS\.uid/);
});

test('RLS/auditoria: mutation triggers server-side audit and requester snapshot survives user deletion',()=>{
  assert.match(sql,/create or replace function private\.audit_mutation/);
  assert.match(sql,/create trigger %I_audit after insert or update or delete/);
  const requests=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261108100000_solicitacoes_exclusao_com_aprovacao.sql'),'utf8');
  assert.match(requests,/solicitante_id uuid references auth\.users\(id\) on delete set null/);
  assert.match(requests,/solicitante_nome text not null default ''/);
});
