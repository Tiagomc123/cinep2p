'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { posterAutorizado, posterCredito } = require('../public/poster-policy');

test('rejects an unverified poster copied from an indexer', () => {
    assert.equal(posterAutorizado({ poster: 'https://img.yts.example/poster.jpg' }), false);
});

test('accepts an image served by the official TMDB image host', () => {
    assert.equal(posterAutorizado({
        poster: 'https://image.tmdb.org/t/p/w500/poster.jpg',
        provider: 'TMDB'
    }), true);
});

test('requires author, license, and source link for Commons images', () => {
    const poster = 'https://upload.wikimedia.org/wikipedia/commons/poster.jpg';
    assert.equal(posterAutorizado({ poster, provider: 'Wikimedia Commons' }), false);
    assert.equal(posterAutorizado({
        poster,
        provider: 'Wikimedia Commons',
        attribution: {
            author: 'Artista Exemplo',
            license: 'CC BY-SA 4.0',
            url: 'https://commons.wikimedia.org/wiki/File:Poster.jpg'
        }
    }), true);
});

test('does not treat restricted CC BY variants as reuse-approved', () => {
    for (const license of ['CC BY-NC 4.0', 'CC BY-ND 4.0', 'CC BY-SA-NC 4.0']) {
        assert.equal(posterAutorizado({
            poster: 'https://upload.wikimedia.org/wikipedia/commons/poster.jpg',
            provider: 'Wikimedia Commons',
            attribution: {
                author: 'Artista Exemplo',
                license,
                url: 'https://commons.wikimedia.org/wiki/File:Poster.jpg'
            }
        }), false, license);
    }
});

test('provides visible attribution for already-resolved Commons posters', () => {
    assert.deepEqual(posterCredito({
        poster: 'https://upload.wikimedia.org/wikipedia/commons/poster.jpg',
        provider: 'Wikimedia Commons',
        attribution: {
            author: 'Artista Exemplo',
            license: 'CC BY-SA 4.0',
            url: 'https://commons.wikimedia.org/wiki/File:Poster.jpg'
        }
    }), {
        label: 'Wikimedia Commons · Artista Exemplo · CC BY-SA 4.0',
        title: 'Artista Exemplo · CC BY-SA 4.0',
        url: 'https://commons.wikimedia.org/wiki/File:Poster.jpg'
    });
});
