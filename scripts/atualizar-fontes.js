'use strict';

/*
 * CLI de diagnostico das fontes de indexacao.
 *
 *   node scripts/atualizar-fontes.js            -> testa todas as fontes
 *   node scripts/atualizar-fontes.js --limpar-cache
 *   node scripts/atualizar-fontes.js "termo"    -> busca real e mostra ranking
 */

const fontes = require('../src/sources');
const motor = require('../src/torrent/engine');
const { formatarBytes } = require('../src/util/text');

const CINZA = '\x1b[90m';
const VERDE = '\x1b[32m';
const AMARELO = '\x1b[33m';
const VERMELHO = '\x1b[31m';
const CIANO = '\x1b[36m';
const RESET = '\x1b[0m';

function linha() {
    console.log(CINZA + '-'.repeat(88) + RESET);
}

async function testarFontes() {
    console.log(CIANO + '\nTESTE DE SAUDE DAS FONTES DE INDEXACAO\n' + RESET);
    const relatorio = await fontes.statusFontes(true);

    for (const f of relatorio.fontes) {
        const marca = f.online ? VERDE + '[ONLINE]' + RESET : VERMELHO + '[OFFLINE]' + RESET;
        const teste = f.buscaTeste
            ? f.buscaTeste.ok
                ? VERDE + f.buscaTeste.total + ' resultados' + RESET
                : AMARELO + 'busca falhou: ' + f.buscaTeste.erro + RESET
            : CINZA + 'sem teste de busca' + RESET;

        console.log(marca + ' ' + f.nome.padEnd(26, ' ') + ' ' + CINZA + f.baseTestada.padEnd(36, ' ') + RESET + ' ' + teste);
        if (!f.online && f.erro) console.log('         ' + CINZA + f.erro + RESET);
    }

    console.log('\n' + CIANO + 'Resumo:' + RESET + ' ' + relatorio.online + '/' + relatorio.total + ' fontes respondendo\n');
}

async function buscar(termo) {
    console.log(CIANO + '\nBUSCA: "' + termo + '"\n' + RESET);
    const inicio = Date.now();
    const dados = await fontes.buscar(termo, { categoria: 'todos', apenasPtBr: false });

    console.log(CINZA + 'total: ' + dados.total + ' | tempo: ' + (Date.now() - inicio) + 'ms\n' + RESET);

    for (const f of dados.fontes) {
        const marca = f.ok ? VERDE + 'ok' + RESET : VERMELHO + 'falha' + RESET;
        console.log(' ' + marca + ' ' + f.nome.padEnd(24, ' ') + ' ' + String(f.total).padStart(3, ' ') + ' itens  ' + CINZA + f.ms + 'ms' + RESET);
    }

    linha();
    for (const item of dados.itens.slice(0, 25)) {
        const idioma = item.idioma.ptbr ? VERDE + item.idioma.rotulo.padEnd(11, ' ') + RESET : CINZA + 'Original   ' + RESET;
        console.log(
            idioma +
            ' ' + String(item.qualidade).padEnd(6, ' ') +
            ' ' + String(item.seeds).padStart(5, ' ') + ' seeds' +
            ' ' + formatarBytes(item.tamanhoBytes).padStart(9, ' ') +
            ' ' + CIANO + String(item.pontuacao).padStart(7, ' ') + RESET +
            '  ' + item.titulo.slice(0, 62)
        );
    }
    console.log('');
}

(async () => {
    const args = process.argv.slice(2);

    if (args.includes('--limpar-cache')) {
        await motor.limparTudo();
        console.log(VERDE + 'cache de torrents limpo.' + RESET);
        motor.encerrar();
        process.exit(0);
    }

    const termo = args.find((a) => !a.startsWith('--'));
    if (termo) await buscar(termo);
    else await testarFontes();

    motor.encerrar();
    process.exit(0);
})();