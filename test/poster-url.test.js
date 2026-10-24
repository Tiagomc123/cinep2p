'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { posterUrlPermitida } = require('../src/util/poster-url');

test('allows only the two HTTPS poster image hosts', () => {
    assert.equal(posterUrlPermitida('https://image.tmdb.org/t/p/w500/poster.jpg'), true);
    assert.equal(posterUrlPermitida('https://upload.wikimedia.org/wikipedia/commons/poster.jpg'), true);
});

test('rejects loopback, private, non-HTTPS, and lookalike image hosts', () => {
    for (const url of [
        'http://image.tmdb.org/poster.jpg',
        'https://127.0.0.1/poster.jpg',
        'https://localhost/poster.jpg',
        'https://image.tmdb.org.evil.example/poster.jpg',
        'https://evil.example/image.tmdb.org/poster.jpg',
        'https://user:pass@image.tmdb.org/poster.jpg'
    ]) {
        assert.equal(posterUrlPermitida(url), false, url);
    }
});
