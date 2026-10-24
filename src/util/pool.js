'use strict';

async function mapLimit(itens, limite, fn) {
    const lista = Array.from(itens || []);
    const resultados = new Array(lista.length);
    if (!lista.length) return resultados;

    const trabalhadores = Math.max(1, Math.min(Number(limite) || 1, lista.length));
    let cursor = 0;

    async function operario() {
        while (cursor < lista.length) {
            const indice = cursor++;
            try {
                resultados[indice] = await fn(lista[indice], indice);
            } catch (erro) {
                resultados[indice] = { __erro: erro };
            }
        }
    }

    await Promise.all(new Array(trabalhadores).fill(0).map(operario));
    return resultados;
}

function comPrazo(promessa, ms, rotulo) {
    let timer;
    const timeout = new Promise((_, rejeitar) => {
        timer = setTimeout(() => rejeitar(new Error('prazo esgotado: ' + (rotulo || 'operacao'))), ms);
    });
    return Promise.race([promessa, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { mapLimit, comPrazo };