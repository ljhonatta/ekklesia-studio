# Fotos base das peças

**Fase 1:** as peças são silhuetas vetoriais provisórias, desenhadas em `src/garments.js`.

Para trocar por fotos reais, mais adiante:

1. Fotografe ou compre (com licença comercial) cada peça **lisa, na cor branca ou cinza-claro**, de frente e de costas, com fundo removido (PNG transparente), em 2000 × 2400 px.
2. Salve em `assets/garments/<id-da-peça>/<frente|costas>.png`. Por exemplo, `camiseta-masculina/frente.png`.
3. As áreas de impressão em `areasFor()` usam o palco de 1000 × 1200. Alinhe a foto a esse quadro ou ajuste as áreas.
4. A cor da peça passa a ser aplicada por tingimento (multiply) sobre a foto clara. As dobras reais da foto substituem o sombreamento procedural.
