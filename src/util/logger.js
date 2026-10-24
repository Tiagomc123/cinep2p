'use strict';

const NIVEIS = { erro: 0, aviso: 1, info: 2, debug: 3 };
const ATUAL = NIVEIS[(process.env.CINE_LOG || 'info').toLowerCase()] ?? NIVEIS.info;

function carimbo() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emitir(nivel, escopo, args) {
    if (NIVEIS[nivel] > ATUAL) return;
    const rotulo = nivel.toUpperCase().padEnd(5, ' ');
    const linha = '[' + carimbo() + '] ' + rotulo + ' ' + escopo.padEnd(14, ' ') + ' ::';
    const fn = nivel === 'erro' ? console.error : nivel === 'aviso' ? console.warn : console.log;
    fn(linha, ...args);
}

function criar(escopo) {
    return {
        erro: (...a) => emitir('erro', escopo, a),
        aviso: (...a) => emitir('aviso', escopo, a),
        info: (...a) => emitir('info', escopo, a),
        debug: (...a) => emitir('debug', escopo, a)
    };
}

module.exports = { criar, log: criar('cinep2p') };