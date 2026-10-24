'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseByteRange } = require('../src/util/byte-range');

test('parses bounded and open-ended ranges', () => {
    assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
    assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 });
    assert.deepEqual(parseByteRange('bytes=8-99', 10), { start: 8, end: 9 });
});

test('parses suffix ranges', () => {
    assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
    assert.deepEqual(parseByteRange('bytes=-20', 10), { start: 0, end: 9 });
});

test('rejects malformed and unsatisfiable ranges', () => {
    for (const header of ['items=0-1', 'bytes=', 'bytes=1-0', 'bytes=10-', 'bytes=-0', 'bytes=0-1,3-4']) {
        assert.equal(parseByteRange(header, 10), null, header);
    }
    assert.equal(parseByteRange('bytes=0-1', 0), null);
});
