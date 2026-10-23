# cinep2p â€” resumo do projeto

Agregador de catÃ¡logo + streaming de torrent no navegador, com catÃ¡logo PT-BR,
sÃ©ries por episÃ³dio, TV ao vivo e acervo de domÃ­nio pÃºblico.
Roda em PC, Android, TV Box e projetor (PWA instalÃ¡vel).

## Stack

- Node.js 20+ / Express
- WebTorrent (torrent no servidor)
- ffmpeg/ffprobe (remux e transcode)
- Front-end vanilla (sem build), PWA
- hls.js (apenas na pÃ¡gina de TV ao vivo)

## Fontes de conteÃºdo

| Fonte | O que traz | Tipo |
|---|---|---|
| YTS | catÃ¡logo e capas de filme internacional | torrent |
| The Pirate Bay (apibay) | releases PT-BR (dublado, nacional, dual, legendado) e sÃ©ries | torrent |
| iptv-org | canais de TV ao vivo do mundo (paÃ­s e categoria) | HLS |
| Internet Archive | domÃ­nio pÃºblico: documentÃ¡rios, clÃ¡ssicos, animaÃ§Ã£o, noir | HTTP direto |
| TVMaze | metadados de sÃ©rie, temporadas e episÃ³dios | metadados |

Nenhuma fonte exige chave de API.

## CatÃ¡logo (4 modos)

- **PT-BR**: prateleiras dubladas/nacional/dual/legendado + tops HD e DVD
- **Mundo**: catÃ¡logo YTS
- **SÃ©ries**: prateleiras de sÃ©ries PT-BR e busca de sÃ©rie por episÃ³dio (TVMaze)
- **Docs**: documentÃ¡rios, clÃ¡ssicos e animaÃ§Ã£o de domÃ­nio pÃºblico

BotÃ£o **Dublado** forÃ§a PT-BR em todos os modos. Filtro de gÃªnero ativo.

## Busca

- Consulta o YTS (metadados/capa) em paralelo com o TPB
- A busca no TPB dispara vÃ¡rias consultas em paralelo (termo, termo dublado,
  termo nacional, termo dual audio, termo legendado) e mescla por hash
- Releases PT-BR aparecem sempre primeiro; o resto vem depois
- Resultados sem capa buscam a arte automaticamente

## Player

- Modos: Direto -> CompatÃ­vel (remux) -> Leve (transcode 720p/480p), com fallback
  automÃ¡tico quando o navegador recusa o formato
- Troca de faixa de Ã¡udio pelas trilhas reais do arquivo (remux)
- Legendas externas e embutidas no mkv, com ligar/desligar
- Retomar de onde parou, com cÃ³pia local no navegador
- BotÃ£o DiagnÃ³stico (peers, arquivo, codec, leitura, decisÃ£o)
- Controle remoto: setas navegam, OK seleciona, Voltar fecha

## SÃ©ries

- Busca de sÃ©rie por nome (TVMaze) -> temporadas -> episÃ³dios
- Cada episÃ³dio busca releases no TPB e lista as fontes
- Progresso guardado por sÃ©rie/temporada/episÃ³dio (tv:<id>:<TxE>), entÃ£o
  "Continuar assistindo" volta no episÃ³dio certo mesmo trocando de release

## TV ao vivo

- PÃ¡gina /live.html: filtro por paÃ­s, categoria e busca
- Proxy HLS no servidor (resolve CORS e reescreve a playlist)

## EspaÃ§o em disco

- Os dados temporÃ¡rios ficam em ./downloads/<hash>
- Ao fechar o player ou terminar o vÃ­deo, o torrent Ã© removido e os arquivos apagados
- Torrents ociosos sÃ£o liberados apÃ³s IDLE_MINUTES (padrÃ£o 5 min)
- BotÃ£o Cache mostra o uso e permite liberar tudo na hora
- SÃ³ o progresso permanece, em ./data/progress.json

## Endpoints principais

/api/health /api/catalog /api/br /api/search /api/extra /api/poster
/api/tv/search /api/tv/show/:id /api/tv/find
/api/live/meta /api/live /api/live/proxy
/api/archive /api/archive/:id
/api/prepare/:hash /api/stream/:hash /api/subs/:hash /api/status/:hash
/api/stop/:hash /api/diag/:hash
/api/progress /api/storage /api/cleanup

## VariÃ¡veis de ambiente

PORT, DOWNLOAD_DIR, DATA_DIR, METADATA_TIMEOUT (120), IDLE_MINUTES (5),
TRANSCODE_PRESET, TRANSCODE_CRF, MAX_CONNS, PROBE_BYTES,
FFMPEG_PATH, FFPROBE_PATH, FFMPEG_DISABLE=1, QUIET=1, HTTPS=1

## Rodar

    npm install
    npm run https     # https://SEU-IP:3000  (use para instalar como app)
    npm start         # http://localhost:3000

## Limites conhecidos

- Canais de TV ao vivo sÃ£o links pÃºblicos e caem com frequÃªncia
- O proxy HLS usa a banda do servidor
- DomÃ­nio pÃºblico do Archive.org costuma ter legenda sÃ³ em inglÃªs
- Filme brasileiro obscuro pode nÃ£o ter capa (o YTS nÃ£o cataloga produÃ§Ã£o nacional)