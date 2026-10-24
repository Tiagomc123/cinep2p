'use strict';

function parseByteRange(header, total) {
    const size = Number(total);
    if (!Number.isSafeInteger(size) || size <= 0 || typeof header !== 'string') return null;

    const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
    if (!match || (!match[1] && !match[2])) return null;

    let start;
    let end;

    if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
        end = Math.min(end, size - 1);
    }

    return { start, end };
}

module.exports = { parseByteRange };
