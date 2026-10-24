# cinep2p v3 - Agregador P2P PT-BR

Nucleo reescrito para priorizar **audio dublado, dual audio e legendas PT-BR**, cobrindo
Filmes, Series, Animes, Doramas, Novelas, Curtas e Documentarios.

## Fluxo

```
catalogo -> busca multi-fonte -> score de estabilidade -> magnet
        -> WebTorrent (stream sequencial) -> remux/transcode FFmpeg -> player browser
```

## Como rodar

```
npm install
npm start            # http://localhost:3000
npm run worker       # daemon de aquecimento do catalogo (6h)
npm run aquecer      # um unico ciclo de aquecimento
npm run fontes       # diagnostico de saude dos indexadores
```

## Endpoints

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/saude` | estado do processo, cache e binarios |
| GET | `/api/fontes` | saude de cada indexador (com teste de busca real) |
| GET | `/api/categorias` | categorias disponiveis |
| GET | `/api/buscar?q=&categoria=&pagina=&ptbr=` | busca agregada e ranqueada |
| GET | `/api/catalogo?categoria=&pagina=` | catalogo pre-aquecido |
| GET | `/api/torrent/:infoHash` | metadados, lista de arquivos, plano de reproducao |
| GET | `/api/status/:infoHash` | peers, velocidade, progresso |
| GET | `/stream/:infoHash/:indice` | streaming direto com `Range` / HTTP 206 |
| GET | `/transcode/:infoHash/:indice?t=` | remux/transcode FFmpeg para fMP4 |
| GET | `/api/img?u=&ref=` | proxy de poster (contorna hotlink bloqueado) |
| DELETE | `/api/cache` | limpa LRU (`?infoHash=` remove um so) |

## Fontes de indexacao

HTML: Comando Torrents, Torrent dos Filmes, BluDV, BJ-Share, Rede Torrent,
AnimesTorrent, Anime Torrents, Doramas Torrent, Novelas Torrent.
API JSON: The Pirate Bay (apibay), YTS.

Cada fonte declara multiplas bases; o motor tenta em cascata ate obter resultados,
o que absorve a troca frequente de TLD dos sites brasileiros.

## Score de estabilidade

```
pontos = min(seeds, 600) * 0.35
       + bonus de idioma   (dublado 62 / dual 50 / legendado 26 / nacional 14 / original -22)
       + bonus de qualidade (2160p 22 / 1080p 15 / 720p 11 / 480p 5)
       + confiabilidade da fonte * 0.3
       + sanidade de tamanho
```

## Armazenamento

- Maximo de torrents ativos simultaneos (`CINE_MAX_TORRENTS`, padrao 3).
- Limpeza por ociosidade (`CINE_IDLE_MIN`, padrao 12 min).
- Teto de disco com despejo LRU (`CINE_MAX_CACHE_GB`, padrao 25 GB).
- Selecao sequencial de pecas: apenas o arquivo em reproducao e priorizado.

## Compatibilidade de midia

- **direto**: MP4/MOV/WebM com H.264/VP8/VP9/AV1 + AAC/MP3/Opus -> `Range` 206.
- **remux**: MKV com codecs de video suportados -> fMP4 sem reencodar video.
- **transcode**: codecs legados (XviD/MPEG-4) -> H.264 ultrafast.

## Aviso

Os arquivos sao servidos por torrents de terceiros. Seeders oscilam; se um magnet
estiver lento, troque a fonte no player ou escolha outra qualidade.
