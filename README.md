# CineP2P 8.0

## Arquitetura do player

Servidor serve o arquivo BitTorrent BRUTO com `Range: bytes`. Zero CPU,
zero ffmpeg, sem ffprobe. O video comeca com 1% de buffer.

O audio e resolvido no navegador:

1. Ao iniciar o video, o frontend baixa os primeiros 1 MB e faz o parse do
   cabecalho MKV em JavaScript (EBML puro).
2. Identifica as faixas de audio, o codec e o idioma de cada uma.
3. Se a faixa em portugues nao for a primeira, ou o codec for AC3/EAC3/DTS/
   TrueHD/PCM (que o navegador nao decodifica), ativa o RESGATE:
   - segunda conexao HTTP com Range no mesmo stream;
   - demux MKV em JS (SimpleBlock, lacing Xiph/EBML/fixo, timecodes);
   - decodificacao via Web Audio API (`decodeAudioData`), com envelope ADTS
     automatico para AAC;
   - agendamento dos buffers contra `video.currentTime`, com video mutado.

Resultado: audio em portugues audivel, sem transcode no servidor e sem
nenhum player externo.

## Filtros
- `src/validar.js` descarta links de outros filmes (titulo + ano vs IMDb).
- `src/ranking.js` descarta instaladores, ativadores, ISOs, RAR/ZIP, cracks.
  Desligue com `FILTRO_INSTALADOR=0`.

## Rodar
`npm start` -> http://localhost:3000

## Voltar ao transcode
`TRANSCODE=auto` (so quando o codec exigir) ou `TRANSCODE=sempre`.
Nesses modos o ffmpeg entra em acao; sem ele o app continua funcionando
em modo bruto.