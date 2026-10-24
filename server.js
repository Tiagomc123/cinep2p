'use strict';

const path = require('path');
const express = require('express');
const compression = require('compression');
const cors = require('cors');

const config = require('./src/config');
const rotas = require('./src/routes/api');
const motor = require('./src/torrent/engine');
const catalogo = require('./src/catalogo');
const { log } = require('./src/util/logger');
const ff = require('./src/util/ffmpeg');

const app = express();

app.disable('x-powered-by');
app.use(compression({ threshold: 1024 }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
    if (/^\/(api|stream|transcode)\//.test(req.path)) {
        log.debug(req.method, req.originalUrl);
    }
    next();
});

app.use(rotas);

app.use('/api', (req, res) => res.status(404).json({ erro: 'rota nao encontrada', rota: req.originalUrl }));

app.use(express.static(path.join(config.RAIZ, 'public'), { maxAge: 0 }));

app.get('*', (req, res) => {
    res.sendFile(path.join(config.RAIZ, 'public', 'index.html'));
});

catalogo.carregar();

const servidor = app.listen(config.PORT, config.HOST, () => {
    const bin = ff.caminhoDoBinario();
    log.info('cinep2p v3 no ar em http://localhost:' + config.PORT);
    log.info('cache P2P      :', config.TORRENT_DIR);
    log.info('max torrents   :', config.MAX_TORRENTS_ATIVOS, '| ociosidade:', config.TORRENT_IDLE_MIN + 'min');
    log.info('ffmpeg         :', bin.ffmpeg);
    log.info('catalogo       :', JSON.stringify(catalogo.resumo()));
});

function desligar(sinal) {
    log.info('encerrando (' + sinal + ')...');
    servidor.close(() => {
        motor.encerrar();
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 6000);
}

process.on('SIGINT', () => desligar('SIGINT'));
process.on('SIGTERM', () => desligar('SIGTERM'));
process.on('unhandledRejection', (e) => {
    log.aviso('promise rejeitada:', e instanceof Error ? (e.stack || e.message) : String(e));
});
