# Validade

Sistema de **controle de validade** para supermercado: escaneia o código de barras, busca o nome do produto,
controla lotes, quantidades e validades, e tem uma área de **perecíveis** (código de balança, SIF e peso).
Na área de perecíveis também lê as etiquetas 2D (QR/DataMatrix GS1) das balanças, que já trazem peso e validade.
E, se o OCR estiver ligado, lê por foto a **descrição** do produto e o **lote** (que vai para o SIF) do texto da etiqueta.

Nasceu como o modelo pronto **📅 Controle de validade** do [ApkForja](https://github.com/jottacostta/APKFORJA)
(modelo v3, ApkForja V41) e agora evolui neste repositório próprio.

## Estrutura

```
src/app.html         o app (HTML + CSS + JS) com marcadores de configuração
src/leitor-ean.js    leitor de código de barras (EAN-13/8, UPC) e de etiquetas 2D GS1 (QR/DataMatrix), em JavaScript puro
config.json          configuração da loja (nome, cor, dias de aviso, etiqueta da balança…)
build.js             monta o app final a partir do template + config
test/                testes (leitor, build e o app no navegador)
dist/validade.html   app pronto
dist/APP_VALIDADE.js template no formato que o ApkForja embute
docs/                notas técnicas
```

## Gerar o app

```bash
node build.js              # usa config.json
node build.js loja2.json   # outra loja
```

Abra `dist/validade.html` no navegador para testar, ou carregue no ApkForja (etapa **Arquivos**) para virar APK.

## Testes

```bash
npm install                      # só o Playwright, para os testes no navegador
npx playwright install chromium
npm test
```

Sem o Playwright, os testes do app no navegador são pulados e os do leitor e do build rodam assim mesmo.
O GitHub Actions roda tudo a cada push e confere se o `dist/` foi gerado de novo depois de mexer em `src/`.

## Configuração (`config.json`)

| Campo | O que é |
|---|---|
| `nome` | Nome da loja ou setor (título do app) |
| `slogan` | Frase abaixo do nome no cabeçalho (opcional) |
| `cor` | Cor principal (`#RRGGBB`) |
| `dias` | Avisar quando faltar quantos dias para vencer |
| `dig` | Etiqueta da balança: dígitos do código do produto (4, 5 ou 6) |
| `valor` | Valor impresso na etiqueta: `peso` (gramas) ou `preco` (centavos) |
| `whatsapp` | WhatsApp para relatórios (com DDD, opcional) |
| `cosmos` | Token do Cosmos/Bluesoft para buscar produtos brasileiros (opcional) |

## Devolver as melhorias ao ApkForja

1. `node build.js`
2. No ApkForja (as duas edições), troque as constantes `APP_VALIDADE` e `LEITOR_EAN` pelo conteúdo de `dist/APP_VALIDADE.js`.
3. Se os campos mudaram, ajuste o modelo `validade` em `MODELOS` e **suba a `versao`** — os apps dos clientes mostram "Há uma versão nova".
