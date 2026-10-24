'use strict';

const fs = require('fs');
const config = require('./config');
const { criar } = require('./util/logger');
const { chaveDedupe } = require('./util/text');

const log = criar('catalogo');

const CATEGORIAS = ['filmes', 'series', 'animes', 'doramas', 'novelas', 'curtas', 'documentarios'];
const CATEGORIAS_INICIO = CATEGORIAS;
const MAX_POR_CATEGORIA = 400;

let estado = { atualizadoEm: null, versao: 3, categorias: {} };
let carregado = false;
let gravando = false;

function montarAmostraInicio(categorias) {
    const amostra = [];
    for (const categoria of CATEGORIAS_INICIO) {
        amostra.push(...((categorias && categorias[categoria]) || []).slice(0, 40));
    }
    return amostra.sort((a, b) => (b.pontuacao || 0) - (a.pontuacao || 0));
}

function carregar() {
    if (carregado) return estado;
    carregado = true;
    try {
        if (fs.existsSync(config.CATALOGO_ARQ)) {
            const bruto = JSON.parse(fs.readFileSync(config.CATALOGO_ARQ, 'utf8'));
            if (bruto && bruto.categorias) estado = bruto;
            log.info('catalogo carregado de', config.CATALOGO_ARQ);
        }
    } catch (erro) {
        log.aviso('falha ao ler catalogo:', erro.message);
    }
    for (const c of CATEGORIAS) if (!estado.categorias[c]) estado.categorias[c] = [];
    return estado;
}

function gravar() {
    if (gravando) return;
    gravando = true;
    try {
        estado.atualizadoEm = new Date().toISOString();
        fs.writeFileSync(config.CATALOGO_ARQ, JSON.stringify(estado), 'utf8');
    } catch (erro) {
        log.aviso('falha ao gravar catalogo:', erro.message);
    } finally {
        gravando = false;
    }
}

function adicionar(categoria, itens) {
    carregar();
    const alvo = estado.categorias[categoria] || (estado.categorias[categoria] = []);
    const indice = new Map(alvo.map((i) => [i.infoHash || chaveDedupe(i.titulo), i]));

    for (const item of itens || []) {
        const chave = item.infoHash || chaveDedupe(item.titulo);
        const existente = indice.get(chave);
        if (existente) {
            if (item.pontuacao > existente.pontuacao) Object.assign(existente, item);
            continue;
        }
        indice.set(chave, item);
        alvo.push(item);
    }

    alvo.sort((a, b) => (b.pontuacao || 0) - (a.pontuacao || 0));
    if (alvo.length > MAX_POR_CATEGORIA) alvo.length = MAX_POR_CATEGORIA;
    estado.categorias[categoria] = alvo;
    return alvo.length;
}

function listar(categoria, opcoes) {
    carregar();
    const opt = opcoes || {};
    const pagina = Math.max(1, Number(opt.pagina) || 1);
    const porPagina = Math.max(1, Number(opt.porPagina) || 60);

    let itens;
    if (!categoria || categoria === 'inicio') {
        itens = montarAmostraInicio(estado.categorias);
    } else {
        itens = estado.categorias[categoria] || [];
    }

    if (opt.termo) {
        const alvo = String(opt.termo).toLowerCase();
        itens = itens.filter((i) => String(i.titulo).toLowerCase().includes(alvo));
    }

    const total = itens.length;
    return {
        categoria: categoria || 'inicio',
        total,
        pagina,
        porPagina,
        totalPaginas: Math.max(1, Math.ceil(total / porPagina)),
        atualizadoEm: estado.atualizadoEm,
        itens: itens.slice((pagina - 1) * porPagina, pagina * porPagina)
    };
}

function resumo() {
    carregar();
    const contagem = {};
    for (const c of CATEGORIAS) contagem[c] = (estado.categorias[c] || []).length;
    return {
        atualizadoEm: estado.atualizadoEm,
        total: Object.values(contagem).reduce((a, b) => a + b, 0),
        categorias: contagem
    };
}

module.exports = { CATEGORIAS, carregar, gravar, adicionar, listar, resumo, montarAmostraInicio };
