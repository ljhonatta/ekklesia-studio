# EKKLESIA STUDIO

Estúdio interno da marca EKKLESIA: ideia → arte → mockup → produto → catálogo → venda.

## Regras
- **Arte, mockup e produção nunca são a mesma coisa.** Ficam em tabelas separadas (`versions`, `mockups` e `productionFiles`).
- **Versões são imutáveis.** Nunca altere `original` nem apague versões automaticamente. "Tornar atual" só muda o ponteiro `currentVersionId`.
- App estático: HTML, CSS e módulos ES, sem etapa de build. Bibliotecas vêm por CDN, sempre com versão fixa.
- Dados ficam no IndexedDB (Dexie) em `src/db.js`. Antes de mudar uma tabela, crie `db.version(N+1)` com migração.
- Cada tela fica em `src/modules/*.js` e exporta `render(el, params, query)`, que opcionalmente retorna uma função de limpeza.
- O PDF do catálogo (`src/pdf-catalog.js`) usa as fontes padrão do jsPDF (WinAnsi). Passe todo texto por `safe()`.
- Fotos de peças do fornecedor (`photos`) nunca entram no repositório (público). São importadas no navegador.
- Interface em pt-BR, estética preta, branca e neutra, com detalhes dourados (`--gold`). Nada de símbolos religiosos decorativos.

## Rodar
`python3 -m http.server 8740` na raiz e abra http://localhost:8740

## Fases
F1 base · F2 produto, produção, catálogo PDF e QR (atual) · F3 IA (Claude SVG + API de imagem, remoção de fundo) · F4 catálogo publicado · F5 mockups com modelo e novas peças.

## Acesso (login)
O Estúdio só abre com e-mail + senha (`src/auth.js`). No código fica só o hash PBKDF2-SHA256 de `email.lower() + "\n" + senha`, com 310000 iterações e um salt aleatório. Nunca coloque a senha em texto no repositório (ele é público). Para trocar a senha ou adicionar alguém, gere um registro novo:
`python3 -c "import hashlib,base64,secrets;e='EMAIL';p='SENHA';s=secrets.token_bytes(16);print(base64.b64encode(s).decode(),base64.b64encode(hashlib.pbkdf2_hmac('sha256',(e.lower()+'\n'+p).encode(),s,310000)).decode())"`
e coloque em `USERS`. Trocar o hash derruba as sessões abertas.

## Nuvem (sincronização)
`src/sync.js` sincroniza todas as tabelas com o repositório **privado** `ljhonatta/ekklesia-studio-dados`: `db/<tabela>/<chave>.json` e `blobs/<git-sha>` para as imagens. O merge é de 3 vias contra a base salva em localStorage (`ekk-sync`); quando os dois lados mudam, vence o `updatedAt` mais recente. Hooks do Dexie geram ids únicos entre aparelhos (`Date.now()*1000+rand`) e carimbam `updatedAt` em toda alteração. `lojaToken` e `lojaUltima` não sincronizam.

## IA (OpenAI)
`src/openai.js` chama a API direto do navegador com a chave do usuário (setting `openaiKey`: fora da nuvem e do backup). Modelos escolhidos em Configurações a partir de `/v1/models`. Gerador em `#/ia`; botão "Deixar realista com IA" no editor de mockup (salva como mockup novo com `ai: true`).

## Encaixe da estampa
`shirt.js` gera `torsoMask` (peça sem as mangas) e `torso` (caixa); fotos sem pessoa usam `analyzeGarment` (recorte pelo fundo). Área `total` = frente/costas inteira, arte em cover. Frente/costas recortam pela `torsoMask`; mangas pela máscara inteira.

## Modelos base + criar produto com arte
Fotos de modelo vestindo ficam em `photos` com `peca` ('oversize-masc' | 'oversize-fem' | 'tech-fem') e `cor`. Produtos base com o mesmo `peca` ganham o botão "Criar produto com arte" (`src/modules/apply-art.js`): estampa a arte (costas/frente, área escolhida) em todas as fotos das cores marcadas, troca a cor da tinta pelo tom cadastrado da camisa e cria o produto (Ativo = vai para o site).

## Vendas (Firebase ekklesia-loja)
Pedidos, contas de cliente, custos e estoque ficam no Firebase (projeto `ekklesia-loja`, Firestore em São Paulo). O site grava pedidos em `pedidos`; o painel `#/vendas` (`src/modules/vendas.js` + `src/fb-admin.js`) lê tudo como admin. Admin = `jhonatta258@gmail.com` ou `contato@ekklesiastoreide.com.br`, com e-mail confirmado (regras em `ekklesia-loja/firestore.rules`, publicadas no console). Internos em `interno/config`, `interno/estoque`, `interno/custos/pedidos/{id}`. Teste local do painel: `.test/vendas.html` com `.test/fb-mock.js`.

## Web app
`manifest.webmanifest` + `sw.js` (rede primeiro, cache como reserva offline). Os ícones ficam em `assets/icons/` e a logo padrão em `assets/logo.png`.

## Antes de cada commit
Rode `python3 tools/stamp.py`. Ele carimba a versão (hash) dos JS/CSS no `index.html`, com um importmap, para o navegador nunca usar uma cópia velha.
