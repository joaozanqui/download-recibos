# Download de Recibos — Farmácia Zanqui

Ferramenta web para download em lote de recibos PDF, organizados automaticamente em pastas por transportadora.

## Como usar

1. Abra o `index.html` no **Google Chrome** (obrigatório).
2. Clique em **Selecionar pasta** e escolha o local de destino (ex.: sua pasta Downloads).
3. Cole os links em cada campo:
   - **FM V2** — links de rastreio/recibo da transportadora FM V2
   - **FM V2 EXP** — links da FM V2 EXP
   - **Total Express** — links da Total Express
4. Clique em **Baixar recibos**.

## Estrutura de pastas gerada

```
[Pasta selecionada]/
└── 2025-06-03_14-30-00/
    ├── FM V2/
    │   ├── recibo_0001.pdf
    │   └── recibo_0002.pdf
    ├── FM V2 EXP/
    │   └── recibo_0001.pdf
    └── Total Express/
        └── recibo_0001.pdf
```

## Requisitos

- **Google Chrome** (ou Edge/Chromium) — necessário para a API de acesso a pastas (`showDirectoryPicker`).
- Os links devem estar acessíveis no navegador com a sessão ativa na transportadora.

## Notas técnicas

- Os arquivos são baixados sequencialmente (um de cada vez) com intervalo de 250 ms entre cada download para não sobrecarregar o servidor.
- Se um link falhar, o erro é registrado no log e o processo continua automaticamente.
- O nome do arquivo é obtido do cabeçalho `Content-Disposition` da resposta. Se não disponível, usa o padrão `recibo_XXXX.pdf`.
