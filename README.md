# EKKLESIA STUDIO

Estúdio interno da EKKLESIA para transformar uma ideia de roupa em **design → mockup → produto → catálogo → venda**.

## Fase 1 (atual)
- Dashboard com o fluxo e os números da coleção.
- Upload de arte (PNG, JPG, WEBP, SVG). O original é preservado e cada envio vira uma versão (V1, V2…).
- Biblioteca com filtros por status e busca.
- Página do design com histórico de versões, opção "tornar atual" e um checklist de prontidão para produção (transparência e DPI).
- Mockup Studio: camiseta masculina, feminina, babylook e oversized; frente e costas; 9 cores mais cor livre; áreas de impressão predefinidas; ajuste de X, Y, escala, rotação e opacidade; arrastar com o mouse; tamanho estimado em cm; exportação em PNG e JPG.
- Configurações da marca e backup/restauração em JSON.

## Fase 2 (atual)
- **Arquivos de Produção**, separados do mockup: técnica (DTF, DTG, serigrafia, bordado, sublimação, transfer), área, tamanho em cm, cores detectadas, observações, checklist por técnica e marcação "pronto para a gráfica". Exporta PNG transparente em 300 DPI (com DPI gravado no arquivo), PDF de produção 1:1 com marcas de corte e o arquivo original.
- **Produtos** com ficha técnica completa: SKU, categoria, descrição, material, gramatura, cores, tamanhos, tabela de medidas, técnica, preço, parcelamento, disponibilidade, link de compra, design, arquivo de produção e mockups. Cada produto tem página própria com o botão COMPRAR AGORA.
- **Catálogo**: escolha e ordene as peças. O PDF é gerado com capa, apresentação da marca, índice clicável, uma página por peça (botão de compra e QR Code) e contracapa com os botões VER SITE, INSTAGRAM e WHATSAPP.

**Peças reais (fotos do fornecedor):** em Mockups → Peças reais, importe as fotos (ou o pacote `EKKLESIA-pecas-reais.json`, já classificado por peça, cor, modelo e vista). No editor, escolha "Peças reais", clique na foto e aplique a arte: ela recebe as dobras e a luz do tecido da foto. Ao importar, uma **IA de detecção de corpo** (MoveNet, roda no navegador) encontra ombros, cotovelos, punhos e quadril de cada foto e posiciona sozinha as áreas: estampa grande, peito central, peito esquerdo/direito, barra esquerda/direita, mangas e, nas fotos de costas, nuca e costas superior/central/inferior. As áreas seguem a inclinação do corpo e a estampa acompanha as dobras. Se algo ficar fora, "Ajustar na foto" corrige só aquela área. As fotos ficam **só no navegador** e não vão para o GitHub.

**Logo oficial:** envie em Configurações → Logo oficial. O sistema recorta o fundo e usa a logo em branco (menu, capa e contracapa), preto (apresentação) e dourado (etiqueta da gola nos mockups).

As peças ainda são **silhuetas provisórias**. Para trocar por fotos, veja `assets/garments/README.md`.

## Rodar localmente
```
python3 -m http.server 8740
```
Depois abra http://localhost:8740.

Os dados ficam **no navegador** (IndexedDB). Faça backup em Configurações.
