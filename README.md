# EKKLESIA STUDIO

Estúdio interno da EKKLESIA para transformar uma ideia de roupa em **design → mockup → produto → catálogo → venda**.

## Fase 1 (atual)
- Dashboard com o fluxo e os números da coleção.
- Upload de arte (PNG, JPG, WEBP, SVG). O original é preservado e cada envio vira uma versão (V1, V2…).
- Biblioteca com filtros por status e busca.
- Página do design com histórico de versões, opção "tornar atual" e um checklist de prontidão para produção (transparência e DPI).
- Mockup Studio: camiseta masculina, feminina, babylook e oversized; frente e costas; 9 cores mais cor livre; áreas de impressão predefinidas; ajuste de X, Y, escala, rotação e opacidade; arrastar com o mouse; tamanho estimado em cm; exportação em PNG e JPG.
- Configurações da marca e backup/restauração em JSON.

As peças ainda são **silhuetas provisórias**. Para trocar por fotos, veja `assets/garments/README.md`.

## Rodar localmente
```
python3 -m http.server 8740
```
Depois abra http://localhost:8740.

Os dados ficam **no navegador** (IndexedDB). Faça backup em Configurações.
