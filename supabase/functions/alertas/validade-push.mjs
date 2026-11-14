export function montarPushValidade(notificacao) {
  const { titulo, mensagem, payload } = notificacao;
  const push = { title: titulo, body: mensagem, data: payload };
  if (titulo !== 'Validade próxima' || typeof payload?.nome !== 'string') return push;

  const nome = payload.nome.trim().replace(/\s+/g, ' ');
  if (!nome || nome === payload.codigo) return push;

  const caracteres = Array.from(nome);
  if (caracteres.length > 32) {
    const prefixo = caracteres.slice(0, 31).join('');
    const cortaPalavra = !/\s$/.test(prefixo) && !/\s/.test(caracteres[31]);
    push.title = (cortaPalavra ? prefixo.replace(/\s+\S+$/, '') : prefixo.trimEnd()) + '…';
  } else {
    push.title = nome;
  }

  const data = typeof payload.validade === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(payload.validade);
  if (data) push.body = `Vence em ${data[3]}/${data[2]}/${data[1]}`;
  return push;
}
