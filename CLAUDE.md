# EKKLESIA STUDIO

Estúdio interno da marca EKKLESIA: ideia → arte → mockup → produto → catálogo → venda.

## Regras
- **Arte, mockup e produção nunca são a mesma coisa.** Ficam em tabelas separadas (`versions`, `mockups` e `productionFiles`).
- **Versões são imutáveis.** Nunca altere `original` nem apague versões automaticamente. "Tornar atual" só muda o ponteiro `currentVersionId`.
- App estático: HTML, CSS e módulos ES, sem etapa de build. Bibliotecas vêm por CDN, sempre com versão fixa.
- Dados ficam no IndexedDB (Dexie) em `src/db.js`. Antes de mudar uma tabela, crie `db.version(N+1)` com migração.
- Cada tela fica em `src/modules/*.js` e exporta `render(el, params, query)`, que opcionalmente retorna uma função de limpeza.
- O PDF do catálogo (`src/pdf-catalog.js`) usa as fontes padrão do jsPDF (WinAnsi). Passe todo texto por `safe()`.
- Interface em pt-BR, estética preta, branca e neutra, com detalhes dourados (`--gold`). Nada de símbolos religiosos decorativos.

## Rodar
`python3 -m http.server 8740` na raiz e abra http://localhost:8740

## Fases
F1 base · F2 produto, produção, catálogo PDF e QR (atual) · F3 IA (Claude SVG + API de imagem, remoção de fundo) · F4 catálogo publicado · F5 mockups com modelo e novas peças.
