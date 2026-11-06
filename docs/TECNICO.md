# Notas técnicas

## Marcadores do template (`src/app.html`)

| Marcador | Substituído por |
|---|---|
| `/*COR*/` | cor principal |
| `/*COR2*/` | cor clara (88%) |
| `/*COR3*/` | cor média (30%) |
| `/*NOME_HTML*/` | nome da loja (escapado) |
| `/*CFG*/` | objeto de configuração `{cosmos,nome,zap,dias,dig,valor}` |
| `/*LEITOR*/` | conteúdo de `src/leitor-ean.js` |

## Ponte Android usada (molde do ApkForja)

Fora do APK o app funciona no navegador; estes recursos só existem no APK:

| Chamada | Uso |
|---|---|
| `Android.requisicao` | busca do produto na internet (sem bloqueio de CORS) |
| `Android.agendarLembrete` / `cancelarLembrete` | aviso de vencimento |
| `Android.lanterna` | lanterna durante a leitura do código |
| `Android.abrirLink` | abrir links externos |

Permissões no APK: câmera, internet, notificações e reinício do aparelho (para manter os lembretes).

## Armazenamento

`localStorage`, chave `'validade_' + nome`. ⚠️ Trocar o `nome` muda a chave e o app abre vazio —
primeira melhoria planejada: chave fixa com migração automática dos dados antigos.
