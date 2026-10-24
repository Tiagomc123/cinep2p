'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encontrarPoster } = require('../src/util/poster-match');

test('finds an exact title match with a poster', () => {
    assert.equal(encontrarPoster('The Simpsons Movie 2007 1080p Dublado', '2007', [
        { tituloBruto: 'The Simpsons Movie', ano: '2007', poster: 'https://img.example/simpsons.jpg' },
        { tituloBruto: 'The Simpsons', ano: '1989', poster: 'https://img.example/show.jpg' }
    ]), 'https://img.example/simpsons.jpg');
});

test('rejects a title with a conflicting year', () => {
    assert.equal(encontrarPoster('King Kong', '2005', [
        { tituloBruto: 'King Kong', ano: '1933', poster: 'https://img.example/king-kong.jpg' }
    ]), '');
});

test('does not return a poster for unrelated titles', () => {
    assert.equal(encontrarPoster('A Cidade das Estrelas', '', [
        { tituloBruto: 'Interstellar', ano: '2014', poster: 'https://img.example/interstellar.jpg' }
    ]), '');
});
