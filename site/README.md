# Site do Kabul (kabul.dev)

Página de divulgação do Kabul, publicada no **Cloudflare Pages** (projeto `kabul`). É separada da documentação
(`docs/`, VitePress no GitHub Pages em https://valteracetto.github.io/kabul/).

- HTML e CSS estáticos gerados por `scripts/build.ts` (sem framework). Inglês em `/`, português em `/pt-BR/`.
- O único JavaScript (`src/site.js`, ~2 KB) melhora o formulário e o botão de copiar o Pix; a página funciona sem ele.
- A lista de espera do Kabul Cloud é uma Pages Function (`functions/api/waitlist.ts`) que grava no KV `WAITLIST`.
- Imagens: as mesmas capturas do README (`docs/assets`), convertidas para AVIF e WebP em várias larguras.

## Onde mudar o quê

| O quê | Onde |
|---|---|
| Domínio (`SITE_URL`), links de download, repositório, documentação | `src/config.ts` (`siteUrl`, um lugar só; a variável de ambiente `SITE_URL` tem precedência) |
| Botões de doação e Pix | `src/config.ts` (`donations`, `pix`) |
| Textos (inglês e português) | `src/content.ts` |
| Estrutura da página, SEO, JSON-LD | `src/page.ts` |
| Visual | `src/styles.css` (cores e fonte Geist do `apps/web`) |
| Headers (CSP, cache), redirects, sitemap, robots, manifest, ícones | gerados em `scripts/build.ts` |
| Imagens de compartilhamento (`og.png`, `og-pt-BR.png`, 1200×630) | `npm run og` (precisa do Chrome) grava em `public/` |

### Doações

Em `src/config.ts`, cada botão em `donations` aparece só quando o `url` está preenchido; enquanto o valor estiver
vazio ou começar com `TODO_`, o botão some sozinho. Hoje só o **GitHub Sponsors** está ligado
(`https://github.com/sponsors/valteracetto`); Buy Me a Coffee, Ko-fi e Open Collective continuam `TODO_`.

O Pix segue a mesma regra: preencha `pix.key` (e, se quiser, `pix.receiver` e `pix.qrImage`, um caminho dentro de
`public/`, por exemplo `/pix-qr.png`). Se nenhum botão nem o Pix estiverem configurados, o bloco "Apoie o
Kabul" inteiro some. O botão "Sponsor" do repositório vem de `.github/FUNDING.yml`.

## Rodar localmente

```sh
cd site
npm ci
npm run build                  # gera dist/
npm run test:links             # links internos e âncoras (use --external para conferir os externos)
npm run check                  # tipos (TypeScript)
npm run dev                    # build + wrangler pages dev em http://127.0.0.1:8788, com KV local
```

O `_headers` leva o hash do CSS embutido na página (CSP). Depois de mudar o CSS e rodar o build de novo,
**reinicie** o `wrangler pages dev`: ele lê o `_headers` só ao subir e, com o hash antigo, o navegador bloqueia o
estilo.

Lighthouse local (com o `npm run dev` rodando):

```sh
npx lighthouse http://127.0.0.1:8788/ --preset=desktop --only-categories=performance,accessibility,best-practices,seo
npx lighthouse http://127.0.0.1:8788/pt-BR/ --only-categories=performance,accessibility,best-practices,seo
```

## Publicar (primeira vez)

Pré-requisito: `npx wrangler login` na conta Cloudflare que tem a zona `kabul.dev`. Os comandos abaixo rodam
dentro de `site/`.

### 1. Criar o projeto Pages `kabul`

```sh
npx wrangler pages project create kabul --production-branch main
```

### 2. Criar o KV da lista de espera e ligar o binding

```sh
npx wrangler kv namespace create WAITLIST
```

O comando imprime um `id`. Cole esse id em `wrangler.toml`, no lugar de `TODO_WAITLIST_KV_NAMESPACE_ID`
(o nome do binding continua `WAITLIST`). O deploy lê o binding do `wrangler.toml`; sem o id certo ele falha.

Sal do hash de IP do limite por IP (segredo, não vai para o repositório):

```sh
openssl rand -hex 32 | npx wrangler pages secret put WAITLIST_SALT --project-name kabul
```

O limite fica em `wrangler.toml` (`WAITLIST_RATE_LIMIT = "5"` cadastros por IP a cada `WAITLIST_RATE_WINDOW =
"3600"` segundos).

### 3. Deploy

```sh
npm run deploy                 # build + wrangler pages deploy dist --project-name kabul --branch main
```

O endereço `https://kabul.pages.dev` já responde depois disso.

### 4. Ligar o domínio kabul.dev

Pelo painel (mais simples): **Workers & Pages › kabul › Custom domains › Set up a custom domain** › `kabul.dev`.
Como a zona está na mesma conta, o Cloudflare cria o registro DNS sozinho.

Pela API (o token precisa de *Cloudflare Pages: Edit* e *DNS: Edit* na zona):

```sh
export CLOUDFLARE_ACCOUNT_ID=...   # Workers & Pages › Account ID
export CLOUDFLARE_API_TOKEN=...
ZONE_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=kabul.dev" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id')

# domínio no projeto Pages
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/kabul/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"name":"kabul.dev"}'

# registro DNS do apex apontando para o Pages (CNAME achatado, com proxy)
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"type":"CNAME","name":"kabul.dev","content":"kabul.pages.dev","proxied":true}'
```

Se o painel já tiver criado o registro do apex, o segundo comando responde que ele existe; tudo bem.

### 5. www.kabul.dev → kabul.dev (301)

O `www` não precisa entrar no projeto Pages: basta um registro com proxy e uma regra de redirecionamento na zona.

Pelo painel: **DNS › Records › Add record**: `CNAME`, nome `www`, destino `kabul.dev`, proxy ligado. Depois
**Rules › Redirect Rules › Create rule** a partir do modelo **"Redirect from WWW to root"** (301, mantendo
caminho e query string).

Pela API (o token também precisa de permissão para editar Redirect Rules / *Single Redirect* na zona):

```sh
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"type":"CNAME","name":"www","content":"kabul.dev","proxied":true}'

# ATENÇÃO: este PUT substitui todas as Redirect Rules da zona (hoje não há nenhuma).
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"rules":[{"description":"www.kabul.dev to kabul.dev","expression":"(http.host eq \"www.kabul.dev\")","action":"redirect","action_parameters":{"from_value":{"status_code":301,"target_url":{"expression":"concat(\"https://kabul.dev\", http.request.uri.path)"},"preserve_query_string":true}}}]}'
```

Conferir:

```sh
curl -sI https://kabul.dev/ | head -5                 # 200 e os headers de segurança
curl -sI https://www.kabul.dev/pt-BR/ | grep -i location   # https://kabul.dev/pt-BR/
curl -s -X POST https://kabul.dev/api/waitlist -H 'accept: application/json' -d 'email=teste@example.com'
```

## Deploy automático (GitHub Actions)

`.github/workflows/site.yml` roda num push para a `main` que mexa em `site/**` ou `docs/assets/**` (e à mão, em
Actions › Site › Run workflow): instala, confere os tipos, faz o build, confere os links e publica com
`wrangler pages deploy`. Ele precisa de dois secrets no repositório (Settings › Secrets and variables › Actions):

- `CLOUDFLARE_API_TOKEN`: token com *Cloudflare Pages: Edit* (e *Workers KV Storage: Edit*);
- `CLOUDFLARE_ACCOUNT_ID`: o Account ID da conta.

Sem os dois, o workflow faz o build e os testes e pula o deploy (avisa no resumo).

## Ler a lista de espera

Cada cadastro é uma chave `email:<e-mail>` com `{"email","use","lang","createdAt","country"}`. As chaves
`rl:<hash>` são o limite por IP e expiram sozinhas.

```sh
npx wrangler kv key list --binding WAITLIST --prefix "email:" --remote | jq -r '.[].name | sub("^email:"; "")'
npx wrangler kv key get "email:alguem@example.com" --binding WAITLIST --remote
```

## Como o formulário funciona

- Sem JavaScript: o navegador manda o formulário (POST `/api/waitlist`) e a função responde 303 para
  `/#waitlist-ok` (ou `-invalid`, `-limited`, `-failed`); o CSS mostra a mensagem certa com `:target`.
- Com JavaScript: o `site.js` manda JSON com `Accept: application/json` e mostra a resposta no lugar.
- Proteções: só aceita POST da mesma origem, corpo até 4 KB, campo-isca `company` (robôs preenchem, a função
  finge que deu certo e não grava), validação do e-mail, limite por IP (hash com sal, guardado com TTL no
  próprio KV). Cadastrar o mesmo e-mail duas vezes não sobrescreve nem revela se ele já estava na lista.
