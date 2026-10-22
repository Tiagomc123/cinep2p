# cinep2p (Fase 0)

Prototipo: catalogo de filmes + busca de magnet + streaming de torrent.

## Rodar
    npm install
    npm start

Abra http://localhost:3000 no PC.
Para testar no celular ou na TV Box, abra o endereco de rede que aparece no terminal.

## Como funciona
- Catalogo e fontes: API publica do YTS
- Fontes extras: apibay (The Pirate Bay), com ranking por seeds/qualidade/idioma
- Streaming: WebTorrent servindo HTTP com suporte a range (seek funciona)

## Cache
Os torrents ficam em ./downloads. Apague a pasta quando quiser liberar espaco.