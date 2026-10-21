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
