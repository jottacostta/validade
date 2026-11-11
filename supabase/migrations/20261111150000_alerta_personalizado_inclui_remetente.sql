-- O remetente também recebe o alerta personalizado que enviou: serve de confirmação e, no primeiro
-- uso, só ele tinha push ativo — sem isso o envio parecia não funcionar.
begin;
do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.enviar_alerta_personalizado(text,text,uuid,text)'::regprocedure);
  v_novo := regexp_replace(v_def, '\n\s*and d\.user_id <> auth\.uid\(\)', '');
  if v_novo = v_def then raise exception 'enviar_alerta_personalizado: exclusão do remetente não encontrada'; end if;
  execute v_novo;
end $$;
commit;
