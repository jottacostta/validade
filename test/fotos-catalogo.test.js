const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261113072753_fotos_catalogo.sql'), 'utf8');

test('Fotos: escopo, primeira inclusão, troca, concorrência e imagem fora do catálogo legado', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema private;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function private.meu_papel() returns text language sql as $$ select current_setting('test.papel',true) $$;
      create function private.tem_escopo_global() returns boolean language sql as $$ select private.meu_papel() = 'admin' $$;
      create function private.membro_da(loja uuid) returns boolean language sql as $$ select loja = '00000000-0000-0000-0000-000000000005' $$;
      create table public.catalogo(ean text primary key, nome text, img text, deleted_at timestamptz);
      create table public.lotes(ean text, loja_id uuid, deleted_at timestamptz);
      insert into public.catalogo values('7890000000001','Nome original','',null),('7890000000002','Com foto','https://legado.invalid/foto',null);
      insert into public.lotes select ean,'00000000-0000-0000-0000-000000000005',null from public.catalogo;
      grant select, update on public.catalogo to authenticated;
      grant usage on schema auth, private to authenticated;
    `);
    await db.exec(sql);
    const loja = '00000000-0000-0000-0000-000000000005';
    const ean = '7890000000001';
    const antiga = 'https://legado.invalid/foto';
    const imagem = 'data:image/jpeg;base64,' + Buffer.from('ffd8ff00ffd9', 'hex').toString('base64');
    const nova = 'https://images.openfoodfacts.org/foto.jpg';
    const salvar = (id, revisao, antes = '', foto = imagem, filial = loja) =>
      db.query('select public.salvar_foto_catalogo($1,$2,$3,$4,$5) as revisao', [id, filial, foto, revisao, antes]);

    await db.exec("set role anon");
    await assert.rejects(salvar(ean, null), /permission denied/);
    await db.exec("reset role; set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001'; set test.papel='operador'");
    await assert.rejects(salvar(ean, null, '', imagem, '00000000-0000-0000-0000-000000000015'), /filial autorizada/);
    await assert.rejects(salvar(ean, null, '', 'https://exemplo.invalid/a.jpg'), /foto_catalogo_conteudo/);
    const grande = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from('ffd8ff','hex'),Buffer.alloc(102400),Buffer.from('ffd9','hex')]).toString('base64');
    await assert.rejects(salvar(ean, null, '', grande), /Foto inválida|foto_catalogo_conteudo/);
    const { revisao } = (await salvar(ean, null)).rows[0];
    await assert.rejects(salvar(ean, null), /A foto mudou/);
    await assert.rejects(salvar(ean, revisao), /Somente gerente/);
    await assert.rejects(salvar('7890000000002', null, antiga), /Somente gerente/);
    await db.query("update public.catalogo set img=$1 where ean='7890000000002'", [nova]);
    assert.equal((await db.query("select img from public.catalogo where ean='7890000000002'")).rows[0].img, antiga);
    await assert.rejects(db.query('update public.fotos_catalogo set url=$1', [nova]), /permission denied/);
    await db.exec("set test.papel='gerente'");
    await assert.rejects(salvar(ean, revisao, '', imagem, '00000000-0000-0000-0000-000000000015'), /filial autorizada/);
    const troca = (await salvar(ean, revisao, '', nova)).rows[0].revisao;
    const resultado = (await db.query('select public.buscar_foto_catalogo($1) as foto', [ean])).rows[0].foto;
    assert.deepEqual(resultado, { img: nova, revisao: troca });
    assert.deepEqual((await db.query('select nome,img from public.catalogo where ean=$1', [ean])).rows, [{nome:'Nome original',img:''}]);
    await db.exec("reset role; update public.catalogo set deleted_at=now() where ean='7890000000001'; set role authenticated");
    assert.equal((await db.query('select public.buscar_foto_catalogo($1) as foto', [ean])).rows[0].foto, null);
  } finally { await db.close(); }
});
