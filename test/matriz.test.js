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
  assert.match(sql,/''gerente''/);
});

test('operador e assistente editam apenas registros próprios no RLS',()=>{
  assert.match(sql,/created_by = auth\.uid\(\)/);
  assert.match(app,/papel==='operador'\|\|papel==='assistente'/);
  assert.match(app,/created_by===SESS\.uid/);
});

test('solicitação e revisão de exclusão passam por RPC',()=>{
  assert.match(app,/rpc\/solicitar_exclusao/);
  assert.match(app,/rpc\/revisar_solicitacao_exclusao/);
  assert.match(sql,/revisar_solicitacao_exclusao/);
});

test('gerente pode excluir contas via Edge Function, analista não',()=>{
  assert.match(edge,/ehAdmin \|\| ehGerente/);
  assert.match(edge,/Somente Gerente ou Administrador pode excluir usuários/);
  assert.match(edge,/const podeEditar = \["analista", "gerente", "admin"\]/);
});

test('sync aplica tombstones recebidos para remover dados locais',()=>{
  assert.match(app,/if\(row\.deleted_at\)\{delete D\.prod\[ean\];return;\}/);
  assert.match(app,/if\(row\.deleted_at\)\{p\.lotes=p\.lotes\.filter/);
});
