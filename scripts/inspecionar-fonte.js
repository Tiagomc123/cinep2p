'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const fontes = require('../src/sources');
const http = require('../src/util/http');

const CANDIDATOS = [
    'article', '.post', '.item', '.card', '.box', '.entry', '.resultado',
    '.result', 'li.post', 'div[class*="item"]', 'div[class*="card"]',
    'div[class*="post"]', 'div[class*="filme"]', 'div[class*="torrent"]',
    'table tr', 'a[href^="magnet:"]', 'a[href$=".torrent"]', 'img'
];

(async () => {
    const id = process.argv[2];
    const termo = process.argv[3] || 'dublado';
    const fonte = fontes.fontePorId(id);
    if (!fonte) {
        console.log('fontes:', fontes.fontesAtivas().map((f) => f.id).join(', '));
        process.exit(1);
    }

    for (const base of fonte.bases) {
        let url;
        try { url = [].concat(fonte.montarBusca(base, termo))[0]; } catch (_) { continue; }
        console.log('\n== ' + fonte.nome + ' :: ' + url);

        let html;
        try {
            html = await http.html(url, { referer: base, tentativas: 0, timeout: 15000 });
        } catch (e) {
            console.log('   FALHA: ' + e.message);
            continue;
        }

        console.log('   status HTML: ' + html.length + ' bytes');
        const $ = cheerio.load(html);
        console.log('   title: ' + $('title').text().trim().slice(0, 90));

        for (const sel of CANDIDATOS) {
            let n = 0;
            try { n = $(sel).length; } catch (_) { continue; }
            if (n > 0) console.log('   [' + String(n).padStart(4) + '] ' + sel);
        }

        const classes = {};
        $('[class]').each((_, el) => {
            String($(el).attr('class') || '').split(/\s+/).forEach((c) => {
                if (c && c.length > 2) classes[c] = (classes[c] || 0) + 1;
            });
        });
        const top = Object.entries(classes).sort((a, b) => b[1] - a[1]).slice(0, 18);
        console.log('   classes mais frequentes: ' + top.map(([c, n]) => c + '(' + n + ')').join(', '));

        const destino = path.join(process.cwd(), '.cache', 'debug');
        fs.mkdirSync(destino, { recursive: true });
        fs.writeFileSync(path.join(destino, id + '.html'), html, 'utf8');
        console.log('   HTML salvo em .cache/debug/' + id + '.html');
        break;
    }
})();