# CineP2P 3.0

Catalogo TMDb (PT-BR) + streaming P2P por torrent, com UI mobile-first estilo Netflix.

## Rodar
1. `TMDB_API_KEY=sua_chave` no `.env`
2. `npm install`
3. `npm start` -> http://localhost:3000
4. No celular (mesma rede): `http://IP-DO-PC:3000`

## Endpoints
- `GET /api/home?tipo=movie|tv`
- `GET /api/filmes/populares | /api/filmes/lancamentos | /api/filmes/top | /api/filmes/genero/:id`
- `GET /api/buscar?q=`
- `GET /api/media/:tipo/:id`
- `GET /api/torrent?titulo=&tituloOriginal=&ano=&imdbId=&tipo=&temporada=&episodio=`
- `GET /api/play`, `/api/play/status`, `/api/play/stream`, `/api/play/stop`

## Scrapers (paralelos)
Torrentio, YTS, ThePirateBay, EZTV, SolidTorrents, TorrentGalaxy, Torrent9,
Commandotorrents, Lapumia, 1337x. Ranking prioriza DUBLADO > PT-BR > DUAL AUDIO
> seeders > qualidade; dedupe por infoHash.

## Disco
Cada reproducao usa `cache/<jobId>`. Ao fechar o player (ou sair da pagina) o
torrent e destruido e a pasta apagada. `CACHE_MODE=keep` mantem os arquivos.

## Capacitor / Cordova
A pasta `public/` e 100% estatica e sem rotas rigidas. Para empacotar:
1. `npx cap init` + `npx cap add android`
2. copie `public/` para o `www/` do projeto Capacitor
3. edite `public/config.js` com `window.CINEP2P_API_BASE = 'http://SEU_IP:3000'`
4. `npx cap sync android && npx cap open android`