# Download Recibos

Pagina web estatica hospedada no GitHub Pages para download em lote de recibos PDF por transportadora, organizados em um único arquivo ZIP.

## O que o sistema faz

Recebe listas de links (FM V2, FM V2 EXP, Total Express), baixa os PDFs via proxy local e empacota tudo em um ZIP com pastas separadas por transportadora.

## Estrutura do projeto

- `index.html` - pagina principal
- `styles.css` - interface visual
- `app.js` - logica de download e geração do ZIP
- `server.ps1` - servidor local com proxy para contornar CORS

## Como usar

1. Acesse a pagina pelo GitHub Pages: https://joaozanqui.github.io/download-recibos/
3. Cole os links em cada campo
4. Clique em **Baixar recibos**
5. O arquivo `Recibos_DATA_HORA.zip` sera salvo na sua pasta Downloads
