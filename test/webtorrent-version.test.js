'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('declares a WebTorrent release that handles textual info hashes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const declaration = manifest.dependencies && manifest.dependencies.webtorrent;
    const major = Number(/^\D*(\d+)/.exec(String(declaration || ''))?.[1]);

    assert.ok(
        major >= 3,
        'WebTorrent 2.8.5 passes parse-torrent.infoHash (a string) to arr2hex; use WebTorrent 3 or newer'
    );
});
