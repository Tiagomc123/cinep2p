'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const config = require('../config');
const { criar } = require('./logger');

const log = criar('ffmpeg');

const EXTENSOES_DIRETAS = ['mp4', 'm4v', 'mov', 'webm'];
const CODECS_VIDEO_DIRETOS = ['h264', 'avc1', 'vp8', 'vp9', 'av1', 'av01'];
const CODECS_VIDEO_REMUXAVEIS = ['h264', 'avc1', 'hevc', 'h265', 'vp8', 'vp9', 'av1', 'av01'];
const CODECS_AUDIO_DIRETOS = ['aac', 'mp3', 'opus', 'vorbis', 'mp4a'];

let binFfmpeg = config.FFMPEG_PATH;
let binFfprobe = config.FFPROBE_PATH;
let resolvido = false;

function resolverBinarios() {
    if (resolvido) return;
    resolvido = true;

    if (!binFfmpeg) {
        try {
            const p = require('ffmpeg-static');
            if (p && fs.existsSync(p)) binFfmpeg = p;
        } catch (_) { /* opcional */ }
    }
    if (!binFfprobe) {
        try {
            const p = require('ffprobe-static');
            const caminho = p && (p.path || p);
            if (caminho && fs.existsSync(caminho)) binFfprobe = caminho;
        } catch (_) { /* opcional */ }
    }

    if (!binFfmpeg) binFfmpeg = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    if (!binFfprobe) binFfprobe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function disponivel() {
    resolverBinarios();
    try {
        fs.accessSync(binFfmpeg, fs.constants.X_OK);
        return true;
    } catch (_) {
        return true;
    }
}

function probe(caminho, opcoes) {
    resolverBinarios();
    const opt = opcoes || {};
    return new Promise((resolver) => {
        const args = [
            '-v', 'error',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            caminho
        ];
        execFile(binFfprobe, args, { timeout: opt.timeoutMs || 20000, maxBuffer: 8 * 1024 * 1024 }, (erro, stdout) => {
            if (erro || !stdout) {
                log.debug('ffprobe falhou:', erro ? erro.message : 'sem saida');
                return resolver(null);
            }
            try {
                const dados = JSON.parse(stdout);
                const streams = dados.streams || [];
                const video = streams.find((s) => s.codec_type === 'video') || {};
                const audio = streams.find((s) => s.codec_type === 'audio') || {};
                const formato = dados.format || {};
                return resolver({
                    container: (formato.format_name || '').split(',')[0],
                    duracaoSeg: parseFloat(formato.duration) || 0,
                    tamanhoBytes: parseInt(formato.size, 10) || 0,
                    videoCodec: video.codec_name || null,
                    audioCodec: audio.codec_name || null,
                    largura: video.width || 0,
                    altura: video.height || 0,
                    canais: audio.channels || 0
                });
            } catch (_) {
                return resolver(null);
            }
        });
    });
}

function planejar(info) {
    if (!info) return { modo: 'remux', tag: null, motivo: 'ffprobe indisponivel' };

    const container = String(info.container || '').toLowerCase().split(',')[0];
    const v = String(info.videoCodec || '').toLowerCase();
    const a = String(info.audioCodec || '').toLowerCase();

    const containerOk = EXTENSOES_DIRETAS.includes(container);
    const videoDireto = CODECS_VIDEO_DIRETOS.includes(v);
    const audioDireto = CODECS_AUDIO_DIRETOS.includes(a) || !a;

    if (containerOk && videoDireto && audioDireto) {
        return { modo: 'direto', tag: null, motivo: 'container e codecs nativos do browser' };
    }

    if (CODECS_VIDEO_REMUXAVEIS.includes(v)) {
        const precisaAac = !CODECS_AUDIO_DIRETOS.includes(a) && !!a;
        return {
            modo: 'remux',
            tag: v === 'hevc' || v === 'h265' ? 'hvc1' : null,
            precisaAac: precisaAac,
            motivo: 'remux de container' + (precisaAac ? ' + audio para AAC' : '')
        };
    }

    return { modo: 'transcode', tag: null, motivo: 'codec de video incompativel (' + (v || 'desconhecido') + ')' };
}

function argumentosConversao(caminho, opcoes) {
    const opt = opcoes || {};
    const plano = opt.plano || { modo: 'remux' };
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];

    if (opt.seek && opt.seek > 0.5) {
        args.push('-ss', String(Math.floor(opt.seek)));
    }

    args.push('-i', caminho, '-map', '0:v:0', '-map', '0:a:0?');

    if (plano.modo === 'transcode') {
        args.push(
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-g', '48',
            '-sc_threshold', '0'
        );
    } else {
        args.push('-c:v', 'copy');
    }

    if (plano.tag) args.push('-tag:v', plano.tag);

    if (plano.modo === 'transcode' || plano.precisaAac) {
        args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000');
    } else {
        args.push('-c:a', 'copy');
    }

    args.push(
        '-sn',
        '-dn',
        '-max_muxing_queue_size', '8192',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1'
    );

    return args;
}

function converter(caminho, opcoes) {
    resolverBinarios();
    const args = argumentosConversao(caminho, opcoes);
    log.debug('ffmpeg', args.join(' '));
    return spawn(binFfmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function caminhoDoBinario() {
    resolverBinarios();
    return { ffmpeg: binFfmpeg, ffprobe: binFfprobe };
}

module.exports = { probe, planejar, converter, disponivel, caminhoDoBinario };