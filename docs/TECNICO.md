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

`localStorage`, chave fixa `'validade_dados'` (trocar o `nome` não perde mais os dados).
Na primeira abertura, se a chave fixa não existir, o app migra a chave antiga `'validade_' + nome`
(ou, se houver só uma chave `validade_*`, essa) e apaga a antiga.

Ao abrir e ao importar backup, `completar()` preenche o que faltar (`prod`, `cat`, `pere`, `aj`) e
padroniza os códigos: UPC-E → UPC-A e UPC-A (12 dígitos) → EAN-13 com `0` na frente, juntando lotes duplicados.
