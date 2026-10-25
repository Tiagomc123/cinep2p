'use strict';

/*
 * worker.js - daemon de aquecimento do catalogo e manutencao do cache.
 *
 *   node worker.js          -> roda um ciclo e mantem intervalo de 6h
 *   node worker.js --once   -> roda um ciclo e sai
 *   node worker.js --fontes -> apenas testa a saude das fontes
 */

const config = require('./src/config');
const fontes = require('./src/sources');
const catalogo = require('./src/catalogo');
const motor = require('./src/torrent/engine');
const { mapLimit } = require('./src/util/pool');
const { criar } = require('./src/util/logger');

const log = criar('worker');

const INTERVALO_MS = Number(process.env.CINE_WORKER_INTERVALO_MIN || 360) * 60 * 1000;
const CONCORRENCIA = config.WORKER_CONCORRENCIA;
let cicloEmAndamento = false;

const CONSULTAS = {
    filmes: [
        'filme dublado 1080p',
        'filme dublado 720p',
        'filme dual audio 1080p',
        'lancamento dublado',
        'filme nacional 1080p',
        'animacao dublada 1080p',
        'filme legendado pt br 1080p'
    ],
    series: [
        'serie dublada 1080p',
        'serie completa dublada',
        'serie dual audio 1080p',
        'temporada completa dublada 720p',
        'serie legendada 1080p'
    ],
    animes: [
        'anime dublado 1080p',
        'anime dublado 720p',
        'anime dual audio 1080p',
        'anime completo dublado',
        'anime legendado 1080p'
    ],
    doramas: [
        'dorama dublado 1080p',
        'dorama legendado 1080p',
        'dorama completo dublado',
        'kdrama dublado 720p',
        'drama coreano dublado'
    ],
    novelas: [
        'novela dublada completa',
        'novela mexicana dublada 1080p',
        'novela turca dublada',
        'telenovela completa',
        'novela legendada 720p'
    ],
    curtas: [
        'curta animacao dublado',
        'curta metragem nacional',
        'curtas animados dublados'
    ]
};

async function ciclo() {
    if (cicloEmAndamento) return;
    cicloEmAndamento = true;
    const inicio = Date.now();
    log.info('iniciando ciclo de aquecimento do catalogo');
    let total = 0;

    const consultas = Object.keys(CONSULTAS).flatMap((categoria) =>
        CONSULTAS[categoria].map((termo) => ({ categoria, termo }))
    );

    try {
        await mapLimit(consultas, CONCORRENCIA, async ({ categoria, termo }) => {
            try {
                const dados = await fontes.buscar(termo, {
                    categoria,
                    limitePorFonte: 20,
                    apenasPtBr: true,
                    resolverMagnet: false
                });

                const uteis = (dados.itens || []).filter(
                    (i) => i.magnet && (i.idioma ? i.idioma.ptbr : true)
                );

                if (uteis.length) {
                    const tamanho = catalogo.adicionar(categoria, uteis);
                    total += uteis.length;
                    log.info('[' + categoria + '] "' + termo + '" ->', uteis.length, 'itens (catalogo:', tamanho + ')');
                }
            } catch (erro) {
                log.aviso('[' + categoria + '] "' + termo + '" falhou:', erro.message);
            }
        });

        catalogo.gravar();
        log.info('ciclo concluido em', ((Date.now() - inicio) / 1000).toFixed(1) + 's | itens processados:', total);
        log.info('resumo do catalogo:', JSON.stringify(catalogo.resumo()));
    } finally {
        cicloEmAndamento = false;
    }
}

async function testarFontes() {
    const relatorio = await fontes.statusFontes(true);
    log.info('fontes online:', relatorio.online + '/' + relatorio.total);
    for (const f of relatorio.fontes) {
        const marca = f.online ? 'OK ' : 'OFF';
        log.info(' ' + marca + ' ' + f.nome.padEnd(24, ' ') + ' ' + (f.erro || f.ms + 'ms') + ' busca=' + JSON.stringify(f.buscaTeste));
    }
}

(async () => {
    const args = process.argv.slice(2);

    if (args.includes('--fontes')) {
        await testarFontes();
        motor.encerrar();
        process.exit(0);
    }

    if (args.includes('--once')) {
        await ciclo();
        motor.encerrar();
        process.exit(0);
    }

    async function executarCicloAgendado() {
        try {
            await ciclo();
        } catch (e) {
            log.erro('ciclo falhou:', e.message);
        } finally {
            setTimeout(executarCicloAgendado, INTERVALO_MS);
        }
    }

    await executarCicloAgendado();
})();
