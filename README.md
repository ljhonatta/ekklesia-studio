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

As peças ainda são **silhuetas provisórias**. Para trocar por fotos, veja `assets/garments/README.md`.

## Rodar localmente
```
python3 -m http.server 8740
```
Depois abra http://localhost:8740.

Os dados ficam **no navegador** (IndexedDB). Faça backup em Configurações.
