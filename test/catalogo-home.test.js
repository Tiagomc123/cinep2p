'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmostraInicio } = require('../src/catalogo');

test('includes documentarios and keeps the home sample ranked', () => {
    const filme = { titulo: 'Filme', pontuacao: 20 };
    const documentario = { titulo: 'Documentario', pontuacao: 10 };
    const itens = montarAmostraInicio({
        filmes: [filme],
        documentarios: [documentario]
    });

    assert.deepEqual(itens, [filme, documentario]);
});
