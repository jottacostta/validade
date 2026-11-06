# Notas técnicas

## Marcadores do template (`src/app.html`)

| Marcador | Substituído por |
|---|---|
| `/*COR*/` | cor principal |
| `/*COR2*/` | cor clara (88%) |
| `/*COR3*/` | cor média (30%) |
| `/*NOME_HTML*/` | nome da loja (escapado) |
| `/*CFG*/` | objeto de configuração `{cosmos,nome,slogan,zap,dias,dig,valor}` |
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

## Leitura pela câmera

Com o `BarcodeDetector` nativo, o leitor próprio só reforça a cada 4 quadros (a imagem inteira a cada 8).
Sem o nativo, ele lê a faixa do meio em todo quadro e a imagem inteira a cada 3. Nada roda com o app em segundo plano.

## Slogan

`CFG.slogan` troca o texto do cabeçalho. Se o ApkForja não mandar `slogan` no CFG, fica o texto padrão do HTML.

## Etiquetas 2D (GS1 — QR/DataMatrix)

Além do EAN-13 de balança (começa com 2), a área de perecíveis lê as etiquetas 2D no padrão **GS1**
(como as da Casas Guanabara), que trazem os dados em campos AI:

| AI | Campo |
|---|---|
| `(01)` | GTIN (14 dígitos) — usado como código do produto |
| `(17)` | Validade (AAMMDD; dia `00` = fim do mês) |
| `(310n)` | Peso líquido em kg (n = casas decimais) |
| `(10)` | Lote |
| `(392n)` / `(393n)` | Preço (valor a pagar) |

`LeitorGS1.ler(texto)` (em `src/leitor-ean.js`) entende as duas formas que os leitores devolvem:
os campos grudados com separador FNC1/GS, e a forma legível `(01)...(17)...`. Com peso, a etiqueta
abre em **Perecíveis** já com peso e validade preenchidos; só com GTIN, abre em **Produtos**.

O `BarcodeDetector` nativo precisa suportar `data_matrix`/`qr_code` (Android em geral suporta). O leitor
próprio, por foto, só decodifica os códigos de barras 1D — a leitura das etiquetas 2D depende do leitor nativo.
Para não confundir, o GS1 só é tratado quando o formato lido é 2D; EAN/UPC 1D seguem o caminho normal.

## OCR da etiqueta (descrição e lote)

A descrição e o lote **não estão no QR** — só no texto impresso. Com o OCR ligado (Ajustes), ao escanear
um perecível o app também lê a imagem e tenta preencher:

- **Descrição**: primeira linha de texto do topo (ex.: "PERNIL FRACIONADO"), só se ainda estava vazia.
- **Lote → SIF**: o número depois de "LOTE:" (ex.: "876-040326") vai para o campo SIF.

Como funciona: binariza a imagem (limiar de Otsu), reduz para ~1600px e roda o **Tesseract.js** (idioma `por`,
modo de segmentação psm 4). `parseEtiquetaOCR(texto)` (em `src/leitor-ean.js`) extrai descrição e lote do texto lido.

O Tesseract é baixado da web (CDN jsdelivr) sob demanda, na primeira vez, e fica em cache do navegador — depois
funciona offline. Se não carregar (sem internet na 1ª vez) ou falhar, o OCR é ignorado em silêncio e o preenchimento
segue manual. Precisa do leitor nativo só para o QR; o OCR roda no próprio celular, sem enviar a foto para fora.
