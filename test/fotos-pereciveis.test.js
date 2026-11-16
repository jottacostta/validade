const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261116170000_fotos_pereciveis.sql'), 'utf8');

test('Fotos de perecível: global por PLU, escopo da filial, troca só gerente/admin e concorrência', async () => {
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
      create table public.pere_regs(cod text, loja_id uuid, deleted_at timestamptz);
      insert into public.pere_regs values ('6019','00000000-0000-0000-0000-000000000005',null),
        ('7001','00000000-0000-0000-0000-000000000005',now());
      grant usage on schema auth, private to authenticated;
    `);
    await db.exec(sql);
    const loja = '00000000-0000-0000-0000-000000000005';
    const outra = '00000000-0000-0000-0000-000000000015';
    const jpeg = hex => 'data:image/jpeg;base64,' + Buffer.from(hex, 'hex').toString('base64');
    const imagem = jpeg('ffd8ff00ffd9'), nova = jpeg('ffd8ff0101ffd9');
    const salvar = (cod, revisao, foto = imagem, filial = loja) =>
      db.query('select public.salvar_foto_perecivel($1,$2,$3,$4) as revisao', [cod, filial, foto, revisao]);
    const buscar = async cod => (await db.query('select public.buscar_foto_perecivel($1) as foto', [cod])).rows[0].foto;

    await db.exec('set role anon');
    await assert.rejects(salvar('6019', null), /permission denied/);
    await db.exec("reset role; set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001'; set test.papel='promotor'");
    await assert.rejects(salvar('6019', null, imagem, outra), /filial autorizada/);
    await assert.rejects(salvar('7001', null), /filial autorizada/, 'registro excluído não autoriza foto');
    await assert.rejects(salvar('60A9', null), /Foto inválida/);
    await assert.rejects(salvar('6019', null, 'https://exemplo.invalid/a.jpg'), /Foto inválida/);
    await assert.rejects(salvar('6019', null, jpeg('00112233')), /foto_perecivel_conteudo/);
    const grande = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from('ffd8ff', 'hex'), Buffer.alloc(102400), Buffer.from('ffd9', 'hex')]).toString('base64');
    await assert.rejects(salvar('6019', null, grande), /Foto inválida|foto_perecivel_conteudo/);

    const { revisao } = (await salvar('6019', null)).rows[0];
    assert.deepEqual(await buscar('6019'), { img: imagem, revisao });
    await assert.rejects(salvar('6019', null), /A foto mudou/);
    await assert.rejects(salvar('6019', revisao, nova), /Somente gerente/);
    await assert.rejects(db.query('update public.fotos_pereciveis set jpeg=null'), /permission denied/);
    await assert.rejects(db.query("insert into public.fotos_pereciveis(cod,jpeg) values ('1',decode('ffd8ffd9','hex'))"), /permission denied/);

    await db.exec("set test.papel='gerente'");
    const troca = (await salvar('6019', revisao, nova)).rows[0].revisao;
    assert.notEqual(troca, revisao);
    assert.deepEqual(await buscar('6019'), { img: nova, revisao: troca });
    assert.equal(await buscar('9999'), null);
  } finally { await db.close(); }
});
