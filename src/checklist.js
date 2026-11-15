/* Módulo Checklist diário do açougue. É embutido no script principal por build.js. */
var CHECKLIST={lojaId:'',roles:[],loading:false,rounds:[],current:null,models:[],events:[],signatures:[],users:[],configAudit:[],request:0,adminRequest:0,adminRoundRequest:0};
function checklistEsc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function checklistUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));}
function checklistStoreId(){return SESS&&SESS.lojaId?String(SESS.lojaId):'';}
function checklistTemAcessoAtual(){return !!(sbOn()&&logado()&&checklistStoreId()&&CHECKLIST.lojaId===checklistStoreId()&&CHECKLIST.roles.length);}
function checklistApi(path,options){options=options||{};if(!Object.prototype.hasOwnProperty.call(options,'sessao'))options.sessao=SESS;return sbReq(path,options).then(function(r){if(!r||!r.ok){var d=r&&r.dados||{},msg=d.message||d.msg||d.details||d.hint||d.error_description||'Não foi possível concluir a operação.';throw new Error(String(msg));}return r.dados;});}
function checklistRpc(name,body){return checklistApi('/rest/v1/rpc/'+encodeURIComponent(name),{method:'POST',body:body});}
function checklistSetStatus(id,text,error){var e=$(id);if(!e)return;e.textContent=text||'';e.classList.toggle('is-error',!!error);e.classList.toggle('is-success',!error&&!!text);}
function checklistUpdateNav(){var b=$('navChecklist'),ok=checklistTemAcessoAtual();if(b)b.hidden=!ok;if(!ok&&vistaAtual==='checklist'){CHECKLIST.current=null;ir('prod');}}
function checklistAtualizarAcesso(){var seq=++CHECKLIST.request,sess=SESS,loja=checklistStoreId();CHECKLIST.lojaId='';CHECKLIST.roles=[];checklistUpdateNav();
  if(!sbOn()||!logado()||!loja||!checklistUuid(loja)||navigator.onLine===false)return Promise.resolve(false);
  return checklistApi('/rest/v1/checklist_acessos?select=funcao&loja_id=eq.'+encodeURIComponent(loja)+'&user_id=eq.'+encodeURIComponent(SESS.uid)+'&ativo=eq.true&limit=3',{sessao:sess}).then(function(rows){if(seq!==CHECKLIST.request||SESS!==sess||checklistStoreId()!==loja)return false;CHECKLIST.lojaId=loja;CHECKLIST.roles=Array.isArray(rows)?rows.map(function(x){return x.funcao;}):[];checklistUpdateNav();if(CHECKLIST.roles.length&&vistaAtual==='checklist')checklistCarregar();return CHECKLIST.roles.length>0;}).catch(function(){if(seq===CHECKLIST.request){CHECKLIST.lojaId='';CHECKLIST.roles=[];checklistUpdateNav();}return false;});}
function checklistLimparAcesso(){CHECKLIST.request++;CHECKLIST.lojaId='';CHECKLIST.roles=[];CHECKLIST.rounds=[];CHECKLIST.models=[];CHECKLIST.current=null;checklistUpdateNav();}
function checklistHoje(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function checklistDataFmt(v){if(!v)return '—';var p=String(v).slice(0,10).split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:String(v);}
function checklistHoraFmt(v){if(!v)return '';var d=new Date(v);return isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}
function checklistEstado(v){return {rascunho:'Rascunho',submetida:'Aguardando validações',devolvida:'Devolvida para correção',validada:'Validada e assinada'}[v]||'Status indisponível';}
function checklistEstadoClass(v){return {rascunho:'draft',submetida:'pending',devolvida:'returned',validada:'approved'}[v]||'draft';}
function checklistSetBusy(ids,busy){(ids||[]).forEach(function(id){var b=$(id);if(b)b.disabled=!!busy;});}
function checklistCarregar(){if(!checklistTemAcessoAtual()){checklistSetStatus('checklistPageStatus','Esta área não está habilitada para seu usuário nesta filial.',true);return Promise.resolve();}
  var loja=CHECKLIST.lojaId,seq=++CHECKLIST.request;$('checklistStoreTitle').textContent=SESS.lojaNome||'Filial selecionada';$('checklistDateLabel').textContent=checklistDataFmt(checklistHoje());checklistSetStatus('checklistPageStatus','Carregando rondas…');
  var q='/rest/v1/checklist_rondas?select=id,loja_id,data_operacional,estado,ativa,modelo_codigo,modelo_titulo,versao_conteudo,criado_por,criado_por_nome,modelo_snapshot,respostas,observacoes&loja_id=eq.'+encodeURIComponent(loja)+'&order=data_operacional.desc,criado_em.desc&limit=90';
  return Promise.all([checklistApi(q),checklistConsultarModelos(loja)]).then(function(result){
    if(seq!==CHECKLIST.request||loja!==checklistStoreId())return;
    CHECKLIST.rounds=result[0]||[];CHECKLIST.models=result[1]||[];
    checklistRenderList();checklistRenderKpis();checklistSetStatus('checklistPageStatus','');
  }).catch(function(e){if(seq===CHECKLIST.request)checklistSetStatus('checklistPageStatus','Não foi possível consultar as rondas: '+e.message,true);});}
function checklistConsultarModelos(loja){
  return checklistApi('/rest/v1/checklist_modelos?select=codigo,titulo,loja_id,versao,estrutura&ativo=eq.true&or=(loja_id.is.null,loja_id.eq.'+encodeURIComponent(loja)+')&order=titulo.asc').then(function(rows){
    var modelos=new Map();
    (rows||[]).forEach(function(m){if(m.loja_id===loja||!modelos.has(m.codigo))modelos.set(m.codigo,m);});
    return Array.from(modelos.values());
  });
}
function checklistRenderKpis(){var counts={validada:0,submetida:0,rascunho:0,devolvida:0};CHECKLIST.rounds.forEach(function(r){counts[r.estado]=(counts[r.estado]||0)+1;});var node=$('checklistKpis');if(!node)return;node.innerHTML=[['Rondas recentes',CHECKLIST.rounds.length,'total'],['Aguardando validação',counts.submetida,'pending'],['Devolvidas',counts.devolvida,'returned'],['Validadas',counts.validada,'approved']].map(function(x){return '<div class="checklist-kpi '+x[2]+'"><small>'+x[0]+'</small><b>'+x[1]+'</b></div>';}).join('');}
function checklistRondaHoje(codigo){
  return CHECKLIST.rounds.find(function(r){return r.data_operacional===checklistHoje()&&r.modelo_codigo===codigo;});
}
function checklistRenderStart(){
  var select=$('checklistModelSelect'),r=checklistRondaHoje(select.value),botao=$('checklistStart');
  botao.disabled=!select.value||!checklistTemAcessoAtual()||CHECKLIST.loading;
  botao.textContent=r?'Abrir ronda de hoje':'Iniciar ronda de hoje';
}
function checklistRenderList(){
  var select=$('checklistModelSelect'),anterior=select.value;
  select.innerHTML=CHECKLIST.models.map(function(m){return '<option value="'+checklistEsc(m.codigo)+'">'+checklistEsc(m.titulo)+'</option>';}).join('');
  if(CHECKLIST.models.some(function(m){return m.codigo===anterior;}))select.value=anterior;
  $('checklistStartControls').hidden=!CHECKLIST.roles.includes('executor')||!CHECKLIST.models.length;
  checklistRenderStart();
  function render(r){
    var estado=r.ativa?checklistEstado(r.estado):'Inativa · '+checklistEstado(r.estado);
    return '<button class="checklist-round-row" type="button" data-checklist-open="'+checklistEsc(r.id)+'"><span class="checklist-round-date"><b>'+checklistEsc(r.modelo_titulo)+'</b><small>'+checklistEsc(checklistDataFmt(r.data_operacional))+' · '+checklistEsc(r.criado_por_nome||'Responsável não informado')+'</small></span><span class="checklist-state '+checklistEstadoClass(r.estado)+'">'+checklistEsc(estado)+'</span><span class="checklist-round-arrow" aria-hidden="true">›</span></button>';
  }
  function preencher(id,rondas,vazio){
    var root=$(id);
    root.innerHTML=rondas.map(render).join('')||'<p class="checklist-empty">'+vazio+'</p>';
    root.onclick=function(e){var b=e.target.closest('[data-checklist-open]');if(b)checklistAbrirRonda(b.dataset.checklistOpen);};
  }
  preencher('checklistRoundList',CHECKLIST.rounds.filter(function(r){return r.ativa&&r.estado!=='validada';}),'Nenhuma ronda ativa.');
  preencher('checklistRoundHistory',CHECKLIST.rounds.filter(function(r){return !r.ativa||r.estado==='validada';}),'Nenhuma ronda no histórico recente.');
}
function checklistFlatten(model){var out=[];(model&&model.secoes||[]).forEach(function(s){(s.itens||[]).forEach(function(i){out.push({section:s,item:i});});});return out;}
function checklistResposta(round,id){var x=round&&round.respostas&&round.respostas[id];return x&&typeof x==='object'?x:{resposta:'',ilhas_c:'',peixes_c:''};}
function checklistCanEdit(r){return r.ativa&&CHECKLIST.roles.indexOf('executor')>=0&&['rascunho','devolvida'].includes(r.estado);}
function checklistRenderSections(){var r=CHECKLIST.current,root=$('checklistSections');if(!r||!root)return;var flat=checklistFlatten(r.modelo_snapshot),done=flat.filter(function(x){return !!checklistResposta(r,x.item.id).resposta;}).length,pct=flat.length?Math.round(done*100/flat.length):0,edit=checklistCanEdit(r);
  $('checklistProgressText').textContent=done+' de '+flat.length+' itens respondidos';$('checklistProgressBar').style.width=pct+'%';$('checklistRoundTitle').textContent=r.modelo_titulo;$('checklistRoundDate').textContent=checklistDataFmt(r.data_operacional);$('checklistRoundOwner').textContent=r.criado_por_nome||'—';$('checklistRoundStatus').className='checklist-state '+checklistEstadoClass(r.estado);$('checklistRoundStatus').textContent=checklistEstado(r.estado);
  $('checklistObservations').value=r.observacoes||'';$('checklistObservations').disabled=!edit;
  $('checklistReadOnlyNotice').hidden=edit;$('checklistReadOnlyNotice').textContent=!r.ativa?'Ronda inativa. As respostas e assinaturas estão disponíveis para consulta.':r.estado==='submetida'?'Ronda enviada. O conteúdo está bloqueado enquanto aguarda as duas validações da liderança.':r.estado==='validada'?'Ronda concluída. O registro e as assinaturas desta versão são somente leitura.':'Somente o usuário designado como executor pode preencher ou corrigir esta ronda.';
  $('checklistEditorActions').hidden=!edit;
  root.innerHTML=(r.modelo_snapshot.secoes||[]).map(function(section){return '<section class="checklist-section card"><header><span class="checklist-section-number">'+checklistEsc(section.id.replace('secao_',''))+'</span><div><h3>'+checklistEsc(section.titulo)+'</h3><p>'+((section.itens||[]).length)+' itens de verificação</p></div></header><div class="checklist-items">'+(section.itens||[]).map(function(item){var id=checklistEsc(item.id),a=checklistResposta(r,item.id),temp=Array.isArray(item.temperaturas);return '<article class="checklist-item" data-checklist-item="'+id+'"><div class="checklist-item-copy"><b>'+checklistEsc(item.titulo)+'</b><p>'+checklistEsc(item.descricao||'')+'</p></div><fieldset class="checklist-answer" '+(!edit?'disabled':'')+'><legend>Conforme?</legend><label><input type="radio" name="check-'+id+'" value="SIM" '+(a.resposta==='SIM'?'checked':'')+'><span>Sim</span></label><label><input type="radio" name="check-'+id+'" value="NÃO" '+(a.resposta==='NÃO'?'checked':'')+'><span>Não</span></label></fieldset>'+(temp?'<div class="checklist-temperature">'+(item.texto_temperaturas?'<p class="checklist-temperature-instruction">'+checklistEsc(item.texto_temperaturas)+'</p>':'')+'<label>Temperatura das ilhas (°C)<input type="number" step="0.1" inputmode="decimal" data-temperature="ilhas_c" value="'+checklistEsc(a.ilhas_c)+'" '+(!edit?'disabled':'')+'></label><label>Geladeira de peixes (°C)<input type="number" step="0.1" inputmode="decimal" data-temperature="peixes_c" value="'+checklistEsc(a.peixes_c)+'" '+(!edit?'disabled':'')+'></label></div>':'')+'</article>';}).join('')+'</div></section>';}).join('');
  root.onchange=function(e){if(e.target.matches('input[type=radio],input[data-temperature]'))checklistUpdateDraftView();};
  $('checklistObservations').oninput=function(){checklistUpdateDraftView();};
  checklistUpdateDraftView();}
function checklistDraftFromForm(){var r=CHECKLIST.current,out={};if(!r)return out;(r.modelo_snapshot.secoes||[]).forEach(function(s){(s.itens||[]).forEach(function(i){var sectionRoot=$('checklistSections'),node=sectionRoot&&sectionRoot.querySelector('[data-checklist-item="'+i.id+'"]');if(!node)return;var checked=node.querySelector('input[type=radio]:checked'),obj={resposta:checked?checked.value:''};var a=node.querySelector('[data-temperature="ilhas_c"]'),b=node.querySelector('[data-temperature="peixes_c"]');if(a)obj.ilhas_c=a.value.trim();if(b)obj.peixes_c=b.value.trim();if(obj.resposta||obj.ilhas_c||obj.peixes_c)out[i.id]=obj;});});return out;}
function checklistDraftComplete(respostas,model){var flat=checklistFlatten(model);return flat.every(function(x){var a=respostas[x.item.id];if(!a||!['SIM','NÃO'].includes(a.resposta))return false;if(Array.isArray(x.item.temperaturas)&&(!String(a.ilhas_c||'').trim()||!String(a.peixes_c||'').trim()||!Number.isFinite(Number(String(a.ilhas_c).replace(',','.')))||!Number.isFinite(Number(String(a.peixes_c).replace(',','.')))))return false;return true;});}
function checklistUpdateDraftView(){var r=CHECKLIST.current;if(!r||!checklistCanEdit(r))return;var responses=checklistDraftFromForm(),flat=checklistFlatten(r.modelo_snapshot),done=flat.filter(function(x){return responses[x.item.id]&&responses[x.item.id].resposta;}).length,pct=flat.length?Math.round(done*100/flat.length):0;$('checklistProgressText').textContent=done+' de '+flat.length+' itens respondidos';$('checklistProgressBar').style.width=pct+'%';$('checklistSubmit').disabled=!checklistDraftComplete(responses,r.modelo_snapshot);}
function checklistRenderSignatures(){var r=CHECKLIST.current,root=$('checklistApprovalTimeline');if(!r||!root)return;var signatures=CHECKLIST.signatures.filter(function(s){return String(s.versao_conteudo)===String(r.versao_conteudo);}),seen={};signatures.forEach(function(s){seen[s.etapa]=s;});var steps=[['encarregado','Encarregado'],['subgerente','Subgerente de Perecíveis']];root.innerHTML=steps.map(function(x){var s=seen[x[0]],ok=s&&s.decisao==='validada',returned=s&&s.decisao==='devolvida';return '<div class="checklist-approval-step '+(ok?'is-approved':returned?'is-returned':'')+'"><span class="checklist-approval-dot">'+(ok?'✓':returned?'!':'·')+'</span><div><b>'+x[1]+'</b><small>'+(s?checklistEsc(s.nome)+' · '+checklistEsc(checklistHoraFmt(s.criado_em))+(returned?' · Devolvida: '+checklistEsc(s.comentario||''):' · Assinatura registrada'):r.estado==='submetida'?'Aguardando assinatura individual':'Pendente de envio para validação')+'</small></div></div>';}).join('');
  var reviewer=CHECKLIST.roles.some(function(role){return (role==='encarregado'||role==='subgerente')&&CHECKLIST.roles.indexOf(role)>=0;});var already=signatures.some(function(s){return s.user_id===SESS.uid;});var creator=r.criado_por===SESS.uid;var canSign=r.ativa&&reviewer&&r.estado==='submetida'&&!already&&!creator;$('checklistSignPanel').hidden=!canSign;$('checklistSignComment').value='';$('checklistReturn').disabled=!canSign;$('checklistApprove').disabled=!canSign;}
function checklistRenderEvents(){var root=$('checklistEventTimeline');if(!root)return;var rows=CHECKLIST.events||[];root.innerHTML=rows.map(function(e){var detail=e.detalhe||{},desc={criada:'Ronda criada',rascunho_salvo:'Rascunho salvo',submetida:'Enviada para validação',devolvida:'Devolvida para correção',assinada:'Etapa de validação assinada',pausada:'Ronda desativada',reativada:'Ronda reativada'}[e.acao]||e.acao;return '<div class="checklist-event"><b>'+checklistEsc(desc)+'</b><span>'+checklistEsc(e.ator_nome||'Usuário')+' · '+checklistEsc(checklistHoraFmt(e.criado_em))+'</span>'+(detail.etapa?'<small>Etapa: '+checklistEsc(detail.etapa)+'</small>':'')+'</div>';}).join('')||'<p class="checklist-muted">Nenhuma atividade registrada.</p>';}
function checklistLoadDetail(r){CHECKLIST.current=r;$('checklistHomePanel').hidden=true;$('checklistFormPanel').hidden=false;checklistRenderSections();checklistSetStatus('checklistActionStatus','Carregando assinaturas e histórico…');var id=encodeURIComponent(r.id);return Promise.all([checklistApi('/rest/v1/checklist_assinaturas?select=id,versao_conteudo,etapa,decisao,user_id,nome,comentario,criado_em&ronda_id=eq.'+id+'&order=criado_em.asc&limit=40',{sessao:SESS}),checklistApi('/rest/v1/checklist_eventos?select=id,ator_nome,acao,detalhe,criado_em&ronda_id=eq.'+id+'&order=criado_em.desc&limit=40',{sessao:SESS})]).then(function(v){if(!CHECKLIST.current||CHECKLIST.current.id!==r.id)return;CHECKLIST.signatures=v[0]||[];CHECKLIST.events=v[1]||[];checklistRenderSignatures();checklistRenderEvents();checklistSetStatus('checklistActionStatus','');}).catch(function(e){checklistSetStatus('checklistActionStatus','Não foi possível carregar o histórico: '+e.message,true);});}
function checklistAbrirRonda(id){
  if(!checklistTemAcessoAtual()||!checklistUuid(id))return Promise.resolve();
  var loja=checklistStoreId(),sessao=SESS;
  return checklistApi('/rest/v1/checklist_rondas?select=*&id=eq.'+encodeURIComponent(id)+'&loja_id=eq.'+encodeURIComponent(loja)+'&limit=1').then(function(rows){
    if(SESS!==sessao||checklistStoreId()!==loja||vistaAtual!=='checklist')return;
    if(!rows||!rows[0])throw new Error('Ronda não encontrada para esta filial.');
    return checklistLoadDetail(rows[0]);
  }).catch(function(e){checklistSetStatus('checklistPageStatus',e.message,true);});
}
function checklistIniciar(){
  var codigo=$('checklistModelSelect').value;
  if(!checklistTemAcessoAtual()||!CHECKLIST.roles.includes('executor')||!codigo||CHECKLIST.loading)return;
  var existing=checklistRondaHoje(codigo);
  if(existing)return checklistAbrirRonda(existing.id);
  var loja=checklistStoreId(),sessao=SESS;
  CHECKLIST.loading=true;checklistRenderStart();
  return checklistRpc('checklist_criar_ronda',{p_loja_id:loja,p_data:checklistHoje(),p_modelo_codigo:codigo}).then(function(id){
    if(SESS!==sessao||checklistStoreId()!==loja||vistaAtual!=='checklist')return;
    if(!checklistUuid(id))throw new Error('O servidor não retornou o identificador da ronda.');
    return checklistCarregar().then(function(){return checklistAbrirRonda(id);});
  }).catch(function(e){checklistSetStatus('checklistPageStatus','Não foi possível iniciar a ronda: '+e.message,true);}).finally(function(){
    CHECKLIST.loading=false;checklistRenderStart();
  });
}
function checklistSalvar(silent){var r=CHECKLIST.current;if(!r||!checklistCanEdit(r))return Promise.reject(new Error('Esta ronda está em modo somente leitura.'));var body={p_ronda_id:r.id,p_respostas:checklistDraftFromForm(),p_observacoes:$('checklistObservations').value.trim()};checklistSetBusy(['checklistSaveDraft','checklistSubmit'],true);checklistSetStatus('checklistActionStatus','Salvando no servidor…');return checklistRpc('checklist_salvar_rascunho',body).then(function(version){r.respostas=body.p_respostas;r.observacoes=body.p_observacoes;r.versao_conteudo=Number(version)||r.versao_conteudo+1;r.estado='rascunho';r.updated_at=new Date().toISOString();return checklistLoadDetail(r).then(function(){if(!silent)checklistSetStatus('checklistActionStatus','Rascunho salvo com segurança no servidor.');return r;});}).catch(function(e){checklistSetStatus('checklistActionStatus','Não foi possível salvar: '+e.message,true);throw e;}).finally(function(){checklistSetBusy(['checklistSaveDraft','checklistSubmit'],false);});}
function checklistSubmeter(){var r=CHECKLIST.current;if(!r||!checklistCanEdit(r))return;if(!checklistDraftComplete(checklistDraftFromForm(),r.modelo_snapshot)){toast('Responda todos os itens e informe as temperaturas solicitadas antes de enviar.');return;}if(!confirm('Enviar esta ronda para validação do Encarregado e do Subgerente de Perecíveis? Depois do envio, o conteúdo ficará bloqueado.'))return;checklistSalvar(true).then(function(){return checklistRpc('checklist_submeter_ronda',{p_ronda_id:r.id});}).then(function(){r.estado='submetida';checklistSetStatus('checklistActionStatus','Ronda enviada. A etapa será concluída após as duas assinaturas individuais.');return checklistLoadDetail(r);}).then(function(){return checklistCarregar();}).catch(function(e){checklistSetStatus('checklistActionStatus','Não foi possível enviar para validação: '+e.message,true);});}
function checklistDecidir(decisao){var r=CHECKLIST.current;if(!r||!r.ativa||r.estado!=='submetida')return;var etapa=CHECKLIST.roles.indexOf('encarregado')>=0?'encarregado':CHECKLIST.roles.indexOf('subgerente')>=0?'subgerente':'';if(!etapa)return;var comentario=$('checklistSignComment').value.trim();if(decisao==='devolvida'&&comentario.length<3){toast('Informe o motivo da devolução (mínimo 3 caracteres).');$('checklistSignComment').focus();return;}if(!confirm(decisao==='validada'?'Confirmar sua assinatura eletrônica interna e aprovação desta etapa?':'Devolver a ronda para correção com o motivo informado?'))return;checklistSetBusy(['checklistReturn','checklistApprove'],true);checklistSetStatus('checklistActionStatus','Registrando sua decisão…');checklistRpc('checklist_assinar_ronda',{p_ronda_id:r.id,p_etapa:etapa,p_decisao:decisao,p_comentario:decisao==='devolvida'?comentario:null}).then(function(state){r.estado=state==='validada'?'validada':state==='devolvida'?'devolvida':'submetida';checklistSetStatus('checklistActionStatus',state==='validada'?'Validação concluída. As duas assinaturas estão registradas.':state==='devolvida'?'Ronda devolvida para correção.':'Sua assinatura foi registrada; aguardando a outra etapa.');return checklistLoadDetail(r);}).then(function(){return checklistCarregar();}).catch(function(e){checklistSetStatus('checklistActionStatus','Não foi possível registrar a decisão: '+e.message,true);}).finally(function(){checklistSetBusy(['checklistReturn','checklistApprove'],false);});}
function checklistConfigStoreId(){return String($('checklistConfigStoreSelect')&&$('checklistConfigStoreSelect').value||'');}
function checklistConfigLoadStores(){if(papelAtual()!=='admin'||!logado())return Promise.resolve();var sel=$('checklistConfigStoreSelect');if(!sel)return Promise.resolve();checklistSetStatus('checklistConfigStatus','Carregando filiais disponíveis…');return sbLojas().then(function(rows){var prev=sel.value;sel.innerHTML='<option value="">Selecione uma filial</option>'+(rows||[]).map(function(x){return '<option value="'+checklistEsc(x.id)+'">'+checklistEsc(x.nome)+'</option>';}).join('');if(prev&&rows.some(function(x){return String(x.id)===prev;}))sel.value=prev;else if(SESS&&SESS.lojaId&&rows.some(function(x){return String(x.id)===String(SESS.lojaId);}))sel.value=String(SESS.lojaId);checklistSetStatus('checklistConfigStatus','');return checklistAdminLoadStore();}).catch(function(){checklistSetStatus('checklistConfigStatus','Não foi possível carregar as filiais. Verifique seu acesso e tente atualizar.',true);});}
function checklistConfigLoadStore(){var loja=checklistConfigStoreId();if(!loja||!checklistUuid(loja)){checklistSetStatus('checklistConfigStatus','Selecione uma filial para editar as designações.');$('checklistConfigStore').textContent='Nenhuma filial selecionada.';return Promise.resolve();}var sel=$('checklistConfigStoreSelect'),label=sel.options[sel.selectedIndex]&&sel.options[sel.selectedIndex].text;$('checklistConfigStore').textContent='Configuração exclusiva da filial: '+(label||loja);checklistSetBusy(['checklistConfigSave'],true);return Promise.all([checklistApi('/rest/v1/loja_membros?select=user_id&loja_id=eq.'+encodeURIComponent(loja)+'&order=user_id.asc&limit=2000',{sessao:SESS}),checklistApi('/rest/v1/checklist_acessos?select=user_id,funcao,ativo&loja_id=eq.'+encodeURIComponent(loja)+'&ativo=eq.true&limit=2000',{sessao:SESS}),checklistApi('/rest/v1/checklist_config_auditoria?select=acao,antes,depois,criado_em,user_id,user_nome&loja_id=eq.'+encodeURIComponent(loja)+'&order=criado_em.desc&limit=12',{sessao:SESS})]).then(function(result){if(checklistConfigStoreId()!==loja)return;var ids=(result[0]||[]).map(function(x){return x.user_id;}).filter(checklistUuid),unique=[...new Set(ids)];if(!unique.length){CHECKLIST.users=[];checklistConfigRenderUsers([],result[1]||[]);checklistSetStatus('checklistConfigStatus','Esta filial não tem usuários vinculados. Vincule usuários à filial antes de ativar o checklist.',true);return;}var inFilter='in.%28'+unique.map(encodeURIComponent).join(',')+'%29';return checklistApi('/rest/v1/perfis?select=id,nome,papel&id='+inFilter+'&limit=2000',{sessao:SESS}).then(function(users){CHECKLIST.users=Array.isArray(users)?users:[];checklistConfigRenderUsers(CHECKLIST.users,result[1]||[]);CHECKLIST.configAudit=result[2]||[];checklistRenderConfigAudit();checklistSetStatus('checklistConfigStatus',CHECKLIST.users.length?'Atribuições carregadas. Os usuários escolhidos precisam ter vínculo ativo com esta filial.':'Nenhum perfil elegível foi encontrado.',!CHECKLIST.users.length);});}).catch(function(e){checklistSetStatus('checklistConfigStatus','Falha ao consultar a configuração da filial: '+e.message,true);}).finally(function(){checklistSetBusy(['checklistConfigSave'],false);});}
function checklistConfigRenderUsers(users,access){var selected={};(access||[]).forEach(function(a){selected[a.funcao+':'+a.user_id]=true;});function options(role){return '<option value="">Selecione um usuário</option>'+users.map(function(u){return '<option value="'+checklistEsc(u.id)+'" '+(selected[role+':'+u.id]?'selected':'')+'>'+checklistEsc(u.nome||'Usuário')+' · '+checklistEsc(u.papel||'perfil não informado')+'</option>';}).join('');}var multi=$('checklistConfigExecutors'),currentExec=(access||[]).filter(function(a){return a.funcao==='executor';}).map(function(a){return String(a.user_id);});multi.innerHTML=users.map(function(u){return '<option value="'+checklistEsc(u.id)+'" '+(currentExec.includes(String(u.id))?'selected':'')+'>'+checklistEsc(u.nome||'Usuário')+' · '+checklistEsc(u.papel||'perfil não informado')+'</option>';}).join('');$('checklistConfigEncarregado').innerHTML=options('encarregado');$('checklistConfigSubgerente').innerHTML=options('subgerente');if(!users.length){multi.innerHTML='<option value="">Sem usuários nesta filial</option>';}}
function checklistRenderConfigAudit(){var root=$('checklistConfigAudit');if(!root)return;root.innerHTML=(CHECKLIST.configAudit||[]).map(function(x){return '<div class="checklist-event"><b>Acessos atualizados</b><span>'+checklistEsc(x.user_nome||'Administrador')+' · '+checklistEsc(checklistHoraFmt(x.criado_em))+'</span><small>Antes: '+checklistEsc(JSON.stringify(x.antes||{}))+' · Depois: '+checklistEsc(JSON.stringify(x.depois||{}))+'</small></div>';}).join('')||'<p class="checklist-muted">Nenhuma alteração de acesso registrada.</p>';}
function checklistConfigSalvar(){if(papelAtual()!=='admin'){toast('Somente o Administrador pode configurar o checklist.');return;}var loja=checklistConfigStoreId(),execs=Array.from($('checklistConfigExecutors').selectedOptions).map(function(o){return o.value;}).filter(checklistUuid),enc=$('checklistConfigEncarregado').value,sub=$('checklistConfigSubgerente').value;if(!checklistUuid(loja)||!execs.length||!checklistUuid(enc)||!checklistUuid(sub)||enc===sub||execs.includes(enc)||execs.includes(sub)){checklistSetStatus('checklistConfigStatus','Selecione uma filial, ao menos um executor e dois revisores distintos que não sejam executores.',true);return;}if(!confirm('Salvar esta configuração somente para a filial selecionada? Usuários não designados não verão a opção Rondas.'))return;checklistSetBusy(['checklistConfigSave','checklistConfigRefresh'],true);checklistSetStatus('checklistConfigStatus','Salvando designações no servidor…');checklistRpc('checklist_configurar_loja',{p_loja_id:loja,p_ativo:true,p_executores:execs,p_encarregado:enc,p_subgerente:sub}).then(function(){checklistSetStatus('checklistConfigStatus','Configuração salva e auditada. Os acessos serão atualizados na próxima verificação de sessão.');return checklistConfigLoadStore();}).catch(function(e){checklistSetStatus('checklistConfigStatus','Não foi possível salvar: '+e.message,true);}).finally(function(){checklistSetBusy(['checklistConfigSave','checklistConfigRefresh'],false);});}
function checklistConfigAbrir(){if(papelAtual()!=='admin'){checklistSetStatus('checklistConfigStatus','Configuração exclusiva do Administrador.',true);return;}checklistConfigLoadStores();}
function checklistInit(){var start=$('checklistStart');if(start)start.onclick=checklistIniciar;var refresh=$('checklistRefresh');if(refresh)refresh.onclick=checklistCarregar;var back=$('checklistBack');if(back)back.onclick=function(){CHECKLIST.current=null;$('checklistFormPanel').hidden=true;$('checklistHomePanel').hidden=false;checklistCarregar();};var save=$('checklistSaveDraft');if(save)save.onclick=function(){checklistSalvar(false).catch(function(){});};var submit=$('checklistSubmit');if(submit)submit.onclick=checklistSubmeter;var approve=$('checklistApprove');if(approve)approve.onclick=function(){checklistDecidir('validada');};var ret=$('checklistReturn');if(ret)ret.onclick=function(){checklistDecidir('devolvida');};var store=$('checklistConfigStoreSelect');if(store)store.onchange=checklistAdminLoadStore;var cfgRefresh=$('checklistConfigRefresh');if(cfgRefresh)cfgRefresh.onclick=checklistAdminLoadStore;var cfgSave=$('checklistConfigSave');if(cfgSave)cfgSave.onclick=checklistConfigSalvar;checklistAtualizarAcesso();}
function checklistAdminContext(){
  return {loja:checklistConfigStoreId(),sessao:SESS,seq:CHECKLIST.adminRequest};
}
function checklistAdminCurrent(ctx){
  return ctx.seq===CHECKLIST.adminRequest&&ctx.sessao===SESS&&ctx.loja===checklistConfigStoreId()&&papelAtual()==='admin';
}
function checklistAdminLoadRounds(ctx){
  var data=$('checklistAdminDate').value,root=$('checklistAdminRoundList'),seq=++CHECKLIST.adminRoundRequest;
  root.textContent=data?'Carregando rondas…':'Selecione uma data.';
  if(!data)return Promise.resolve();
  return checklistApi('/rest/v1/checklist_rondas?select=id,modelo_titulo,ativa,estado&loja_id=eq.'+encodeURIComponent(ctx.loja)+'&data_operacional=eq.'+encodeURIComponent(data)+'&order=modelo_titulo.asc').then(function(rows){
    if(!checklistAdminCurrent(ctx)||seq!==CHECKLIST.adminRoundRequest)return;
    root.innerHTML=(rows||[]).map(function(r){
      return '<div class="checklist-admin-entry"><div><b>'+checklistEsc(r.modelo_titulo)+'</b><small>'+checklistEsc(checklistEstado(r.estado))+'</small></div><label><input type="checkbox" data-ronda-ativa="'+checklistEsc(r.id)+'" aria-label="Ronda ativa: '+checklistEsc(r.modelo_titulo)+'" '+(r.ativa?'checked':'')+'> Ativa</label></div>';
    }).join('')||'<p>Nenhuma ronda gerada nesta data.</p>';
  }).catch(function(e){if(checklistAdminCurrent(ctx)&&seq===CHECKLIST.adminRoundRequest)root.textContent='Não foi possível carregar as rondas: '+e.message;});
}
function checklistAdminLoadModels(ctx){
  var root=$('checklistAdminModelList');
  root.textContent='Carregando modelos…';
  return checklistConsultarModelos(ctx.loja).then(function(rows){
    if(!checklistAdminCurrent(ctx))return;
    var modelos=rows||[];
    root.innerHTML=modelos.map(function(m){
      return '<div class="checklist-admin-entry"><div><b>'+checklistEsc(m.titulo)+'</b><small>'+(m.loja_id?'Versão desta filial':'Modelo padrão')+'</small></div><button type="button" class="btn sec" data-edit-ronda-modelo="'+checklistEsc(m.codigo)+'">Editar</button></div>';
    }).join('')||'<p>Nenhum modelo disponível nesta filial.</p>';
    root.onclick=function(e){
      var b=e.target.closest('[data-edit-ronda-modelo]');
      if(b&&checklistAdminCurrent(ctx))checklistAdminEditModel(modelos.find(function(m){return m.codigo===b.dataset.editRondaModelo;}));
    };
  }).catch(function(e){if(checklistAdminCurrent(ctx))root.textContent='Não foi possível carregar os modelos: '+e.message;});
}
function checklistAdminLoadStore(){
  CHECKLIST.adminRequest++;
  var ctx=checklistAdminContext(),visivel=checklistUuid(ctx.loja);
  $('checklistAdminRounds').hidden=$('checklistAdminModels').hidden=!visivel;
  $('checklistModelForm').hidden=true;
  checklistSetStatus('checklistAdminStatus','');
  if(!visivel)return checklistConfigLoadStore();
  if(!$('checklistAdminDate').value)$('checklistAdminDate').value=checklistHoje();
  return Promise.all([checklistConfigLoadStore(),checklistAdminLoadModels(ctx),checklistAdminLoadRounds(ctx)]);
}
function checklistAdminAddQuestion(root,item){
  if(root.children.length>=20){toast('A seção aceita até 20 perguntas.');return;}
  var box=document.createElement('div');
  box.className='checklist-model-question';
  box.innerHTML='<label class="f">Pergunta<input data-item-titulo maxlength="250" required></label><label class="f">Orientação opcional<textarea data-item-descricao rows="2" maxlength="1000"></textarea></label><label class="checklist-model-temperature"><input data-item-temperaturas type="checkbox"> Exigir medições de temperatura</label><label class="f" data-item-rotulo-temperaturas hidden>Texto sobre a medição<input data-item-texto-temperaturas maxlength="250" placeholder="Exigir temperaturas das ilhas e da geladeira de peixes"></label><button class="btn sec" type="button">Remover pergunta</button>';
  box.querySelector('[data-item-titulo]').value=item?item.titulo:'';
  box.querySelector('[data-item-descricao]').value=item&&item.descricao||'';
  var exige=box.querySelector('[data-item-temperaturas]'),rotulo=box.querySelector('[data-item-rotulo-temperaturas]');
  exige.checked=!!(item&&Array.isArray(item.temperaturas));rotulo.hidden=!exige.checked;
  var texto=rotulo.querySelector('input');
  texto.value=item&&typeof item.texto_temperaturas==='string'?item.texto_temperaturas:texto.placeholder;
  exige.onchange=function(){rotulo.hidden=!exige.checked;};
  box.querySelector('button').onclick=function(){box.remove();};
  root.appendChild(box);
}
function checklistAdminAddSection(section){
  var root=$('checklistModelSections');
  if(root.children.length>=12){toast('O modelo aceita até 12 seções.');return;}
  var fieldset=document.createElement('fieldset');
  fieldset.className='checklist-model-section';
  fieldset.innerHTML='<legend>Seção</legend><label class="f">Nome da seção<input data-titulo-secao maxlength="100" required></label><div data-itens-secao></div><div class="row"><button class="btn sec" type="button" data-add-pergunta>Adicionar pergunta</button><button class="btn sec" type="button" data-remove-secao>Remover seção</button></div>';
  fieldset.querySelector('[data-titulo-secao]').value=section?section.titulo:'';
  var itens=fieldset.querySelector('[data-itens-secao]');
  (section?section.itens:[null]).forEach(function(item){checklistAdminAddQuestion(itens,item);});
  fieldset.querySelector('[data-add-pergunta]').onclick=function(){checklistAdminAddQuestion(itens,null);};
  fieldset.querySelector('[data-remove-secao]').onclick=function(){fieldset.remove();};
  root.appendChild(fieldset);
}
function checklistAdminEditModel(modelo){
  var form=$('checklistModelForm');
  form.dataset.codigo=modelo?modelo.codigo:'';
  form.dataset.versao=modelo?modelo.versao:'';
  $('checklistModelTitle').value=modelo?modelo.titulo:'';
  $('checklistModelSections').replaceChildren();
  var secoes=modelo?modelo.estrutura.secoes:[null];
  secoes.forEach(checklistAdminAddSection);
  form.hidden=false;
  $('checklistModelTitle').focus();
}
function checklistAdminSaveModel(e){
  e.preventDefault();
  var ctx=checklistAdminContext(),form=$('checklistModelForm'),botao=$('checklistModelSave');
  if(!checklistAdminCurrent(ctx)||!checklistUuid(ctx.loja)||botao.disabled)return;
  var secoes=Array.from($('checklistModelSections').children).map(function(s){
    var itens=Array.from(s.querySelector('[data-itens-secao]').children).map(function(box){
      var item={titulo:box.querySelector('[data-item-titulo]').value.trim(),descricao:box.querySelector('[data-item-descricao]').value.trim()};
      if(box.querySelector('[data-item-temperaturas]').checked){
        item.temperaturas=['ilhas_c','peixes_c'];
        item.texto_temperaturas=box.querySelector('[data-item-texto-temperaturas]').value.trim();
      }
      return item;
    });
    return {titulo:s.querySelector('[data-titulo-secao]').value.trim(),itens:itens};
  });
  if(!secoes.length||secoes.some(function(s){return !s.titulo||!s.itens.length||s.itens.some(function(i){return !i.titulo;});})){
    checklistSetStatus('checklistAdminStatus','Informe pelo menos uma seção, com título e 1 a 20 perguntas de até 250 caracteres.',true);return;
  }
  botao.disabled=true;
  return checklistRpc('checklist_salvar_modelo',{
    p_loja_id:ctx.loja,p_codigo:form.dataset.codigo||null,p_versao:Number(form.dataset.versao)||null,
    p_titulo:$('checklistModelTitle').value.trim(),p_secoes:secoes
  }).then(function(){
    if(!checklistAdminCurrent(ctx))return;
    form.hidden=true;checklistSetStatus('checklistAdminStatus','Modelo salvo. As rondas já geradas mantêm suas perguntas.');
    return checklistAdminLoadModels(ctx);
  }).catch(function(err){if(checklistAdminCurrent(ctx))checklistSetStatus('checklistAdminStatus',err.message,true);}).finally(function(){botao.disabled=false;});
}
function checklistAdminInit(){
  $('checklistModelSelect').onchange=checklistRenderStart;
  $('checklistAdminDate').onchange=function(){return checklistAdminLoadRounds(checklistAdminContext());};
  $('checklistNewModel').onclick=function(){checklistAdminEditModel(null);};
  $('checklistModelCancel').onclick=function(){$('checklistModelForm').hidden=true;};
  $('checklistModelAddSection').onclick=function(){checklistAdminAddSection(null);};
  $('checklistModelForm').onsubmit=checklistAdminSaveModel;
  $('checklistAdminRoundList').onchange=function(e){
    var b=e.target.closest('[data-ronda-ativa]'),ctx=checklistAdminContext();
    if(!b||!checklistAdminCurrent(ctx))return;
    var ativa=b.checked;
    b.disabled=true;
    checklistRpc('checklist_definir_ronda_ativa',{p_loja_id:ctx.loja,p_ronda_id:b.dataset.rondaAtiva,p_ativa:ativa}).then(function(){
      if(checklistAdminCurrent(ctx))checklistSetStatus('checklistAdminStatus',ativa?'Ronda ativada.':'Ronda desativada. O histórico foi preservado.');
    }).catch(function(err){
      b.checked=!ativa;
      if(checklistAdminCurrent(ctx))checklistSetStatus('checklistAdminStatus',err.message,true);
    }).finally(function(){b.disabled=false;});
  };
}
checklistInit();
checklistAdminInit();
