'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPosterResolver } = require('../src/posters');

function response(status, body, headers) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => (headers || {})[name.toLowerCase()] || null },
        json: async () => body
    };
}

test('matches a TMDB result by normalized title and exact release year', async () => {
    const resolver = criarPosterResolver({
        apiKey: 'test-key',
        fetchImpl: async () => response(200, { results: [
            { title: 'King Kong', release_date: '1933-04-07', poster_path: '/old.jpg' },
            { title: 'King Kong', release_date: '2005-12-14', poster_path: '/new.jpg' }
        ] })
    });

    const result = await resolver.resolve('King Kong 2005 1080p Dublado', '2005');
    assert.equal(result.provider, 'TMDB');
    assert.equal(result.poster, 'https://image.tmdb.org/t/p/w500/new.jpg');
    assert.equal(result.year, '2005');
});

test('matches a release title that includes the pt-BR language tag', async () => {
    const resolver = criarPosterResolver({
        apiKey: 'test-key',
        fetchImpl: async () => response(200, { results: [
            { title: 'The Simpsons Movie', release_date: '2007-07-27', poster_path: '/simpsons.jpg' }
        ] })
    });

    const result = await resolver.resolve(
        'Os Simpsons - O Filme (2007) 1080p Dublado / Dual Audio pt-BR',
        '2007'
    );

    assert.equal(result.provider, 'TMDB');
    assert.equal(result.poster, 'https://image.tmdb.org/t/p/w500/simpsons.jpg');
    assert.equal(result.year, '2007');
});

test('removes release metadata before querying TMDB', async () => {
    let query = '';
    const resolver = criarPosterResolver({
        apiKey: 'test-key',
        fetchImpl: async (url) => {
            const parsed = new URL(url);
            if (parsed.hostname !== 'api.themoviedb.org') return response(200, { query: { search: [] } });
            query = parsed.searchParams.get('query');
            return response(200, { results: query === 'Os Simpsons O Filme' ? [
                { title: 'The Simpsons Movie', release_date: '2007-07-27', poster_path: '/simpsons.jpg' }
            ] : [] });
        }
    });

    const result = await resolver.resolve(
        'Os Simpsons - O Filme (2007) 1080p Dublado / Dual Audio pt-BR',
        '2007'
    );

    assert.equal(query, 'Os Simpsons O Filme');
    assert.equal(result.poster, 'https://image.tmdb.org/t/p/w500/simpsons.jpg');
});

test('uses Commons only when the title, year, and reusable license match', async () => {
    const resolver = criarPosterResolver({
        fetchImpl: async (url) => {
            const parsed = new URL(url);
            if (parsed.hostname === 'api.themoviedb.org') return response(503, {});
            if (parsed.searchParams.get('list') === 'search') {
                return response(200, { query: { search: [
                    { title: 'File:Os_Simpsons_Movie_2007_poster.jpg' },
                    { title: 'File:Simpsons_1989_poster.jpg' }
                ] } });
            }
            return response(200, { query: { pages: [{ imageinfo: [{
                thumburl: 'https://upload.wikimedia.org/example/poster.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Os_Simpsons_Movie_2007_poster.jpg',
                extmetadata: {
                    LicenseShortName: { value: 'CC BY-SA 4.0' },
                    Artist: { value: '<a>Artista Exemplo</a>' }
                }
            }] }] } });
        }
    });

    const result = await resolver.resolve('Os Simpsons - O Filme (2007) Dual Audio', '2007');
    assert.equal(result.provider, 'Wikimedia Commons');
    assert.equal(result.poster, 'https://upload.wikimedia.org/example/poster.jpg');
    assert.deepEqual(result.attribution, {
        author: 'Artista Exemplo',
        license: 'CC BY-SA 4.0',
        url: 'https://commons.wikimedia.org/wiki/File:Os_Simpsons_Movie_2007_poster.jpg'
    });
});

test('does not return an unlicensed Commons image or a conflicting year', async () => {
    const resolver = criarPosterResolver({
        fetchImpl: async (url) => {
            const parsed = new URL(url);
            if (parsed.hostname === 'api.themoviedb.org') {
                return response(200, { results: [
                    { title: 'King Kong', release_date: '1933-04-07', poster_path: '/wrong.jpg' }
                ] });
            }
            if (parsed.searchParams.get('list') === 'search') {
                return response(200, { query: { search: [
                    { title: 'File:King_Kong_2005_poster.jpg' }
                ] } });
            }
            return response(200, { query: { pages: [{ imageinfo: [{
                thumburl: 'https://upload.wikimedia.org/example/poster.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:King_Kong_2005_poster.jpg',
                extmetadata: { LicenseShortName: { value: 'All rights reserved' } }
            }] }] } });
        }
    });

    const result = await resolver.resolve('King Kong', '2005');
    assert.equal(result.poster, '');
});

test('rejects CC BY images without an author that can be credited', async () => {
    const resolver = criarPosterResolver({
        fetchImpl: async (url) => {
            const parsed = new URL(url);
            if (parsed.searchParams.get('list') === 'search') {
                return response(200, { query: { search: [
                    { title: 'File:Alien_1979_poster.jpg' }
                ] } });
            }
            return response(200, { query: { pages: [{ imageinfo: [{
                thumburl: 'https://upload.wikimedia.org/example/alien.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Alien_1979_poster.jpg',
                extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } }
            }] }] } });
        }
    });

    const result = await resolver.resolve('Alien', '1979');
    assert.equal(result.poster, '');
});

test('rejects Commons licenses with noncommercial or no-derivatives restrictions', () => {
    const { licensePermitida } = require('../src/posters');
    assert.equal(licensePermitida('CC BY-NC 4.0'), false);
    assert.equal(licensePermitida('CC BY-ND 4.0'), false);
    assert.equal(licensePermitida('CC BY-SA 4.0'), true);
});

test('keeps the timeout active until the provider response body is read', async () => {
    let tmdbAborted = false;
    const resolver = criarPosterResolver({
        apiKey: 'test-key',
        timeoutMs: 20,
        sleep: async () => {},
        fetchImpl: async (url, options) => {
            if (new URL(url).hostname === 'api.themoviedb.org') {
                return {
                    ok: true,
                    status: 200,
                    headers: { get: () => null },
                    json: () => new Promise((resolve, reject) => {
                        options.signal.addEventListener('abort', () => {
                            tmdbAborted = true;
                            reject(new Error('body read aborted'));
                        }, { once: true });
                    })
                };
            }
            return response(200, { query: { search: [] } });
        }
    });

    const result = await Promise.race([
        resolver.resolve('Alien', '1979'),
        new Promise((resolve) => setTimeout(() => resolve('timed out waiting for resolver'), 100))
    ]);
    assert.notEqual(result, 'timed out waiting for resolver');
    assert.equal(tmdbAborted, true);
});

test('retries a bounded TMDB 429 response and caches concurrent lookups', async () => {
    let calls = 0;
    let delays = 0;
    const resolver = criarPosterResolver({
        apiKey: 'test-key',
        sleep: async (ms) => { delays += ms; },
        fetchImpl: async () => {
            calls++;
            if (calls === 1) return response(429, {}, { 'retry-after': '1' });
            return response(200, { results: [
                { title: 'Alien', release_date: '1979-05-25', poster_path: '/alien.jpg' }
            ] });
        }
    });

    const [first, second] = await Promise.all([
        resolver.resolve('Alien', '1979'),
        resolver.resolve('Alien', '1979')
    ]);
    assert.equal(first.poster, 'https://image.tmdb.org/t/p/w500/alien.jpg');
    assert.equal(second.poster, first.poster);
    assert.equal(calls, 2);
    assert.equal(delays, 1000);
});
