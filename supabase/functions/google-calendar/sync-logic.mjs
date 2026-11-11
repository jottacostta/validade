/**
 * Helpers puros compartilhados pela Edge Function e pela suíte Node.
 * Não recebem tokens, credenciais ou identificadores de usuário.
 */
export function classificarFalhaToken(grantType, providerError) {
  if (grantType === "refresh_token" && providerError === "invalid_grant") {
    return "refresh_token_revoked";
  }
  return "google_token_exchange_failed";
}

const eventoAusente = (response) => response?.status === 404 || response?.status === 410;
const respostaOk = (response) => response?.ok === true;

/**
 * Reconcile um evento remoto de forma idempotente.
 * - Mapeamento ativo e payload igual: verifica se ainda existe no Calendar.
 * - POST concorrente com o mesmo ID (409): PATCH do evento já criado.
 * - PATCH de evento removido (404/410): recria com o mesmo ID determinístico.
 * Os callbacks isolam os efeitos de rede e permitem testes sem chamar o Google.
 */
export async function reconciliarEventoCalendar({ priorAtivo, payloadIgual, consultar, inserir, atualizar }) {
  let ausenteConfirmado = false;
  if (priorAtivo && payloadIgual) {
    const verificado = await consultar();
    if (respostaOk(verificado)) return { tipo: "skipped", response: verificado };
    if (!eventoAusente(verificado)) return { tipo: "failed", response: verificado };
    ausenteConfirmado = true;
  }

  if (priorAtivo) {
    let response = ausenteConfirmado ? await inserir() : await atualizar();
    if (ausenteConfirmado) {
      if (response.status === 409) {
        response = await atualizar();
        return { tipo: respostaOk(response) ? "updated" : "failed", response };
      }
      return { tipo: respostaOk(response) ? "created" : "failed", response };
    }
    if (eventoAusente(response)) {
      response = await inserir();
      if (response.status === 409) {
        response = await atualizar();
        return { tipo: respostaOk(response) ? "updated" : "failed", response };
      }
      return { tipo: respostaOk(response) ? "created" : "failed", response };
    }
    return { tipo: respostaOk(response) ? "updated" : "failed", response };
  }

  let response = await inserir();
  if (response.status === 409) {
    response = await atualizar();
    return { tipo: respostaOk(response) ? "updated" : "failed", response };
  }
  return { tipo: respostaOk(response) ? "created" : "failed", response };
}
