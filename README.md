# cinep2p

Catalogo de filmes/series + busca de magnet + streaming de torrent no navegador.
Funciona no PC, no celular Android, na TV Box e no projetor.

## Requisitos

- Node.js 22 ou superior
- ffmpeg: ja vem junto (pacotes ffmpeg-static/ffprobe-static). Se quiser usar
  o do sistema, defina FFMPEG_PATH.

## Rodar

    npm install
    npm start          # http://localhost:3000

Abra o endereco de rede mostrado no terminal.

O servidor inicia em HTTP; `npm run https` nao esta configurado nesta versao.
Para instalar como aplicativo em aparelhos da rede local, sera necessario
configurar HTTPS com um certificado confiavel.

Controle remoto: setas navegam, OK seleciona, Voltar fecha o player,
Enter no video abre os botoes. O botao "TV" aumenta a interface.

## Recursos

- Catalogo e capas: API publica do YTS (com espelhos de reserva)
- Fontes extra: apibay (The Pirate Bay), com filtro "Dublado"
- Troca de idioma do audio pelas faixas reais do arquivo (remux)
- Legendas externas e embutidas no mkv, com ligar/desligar
- Continuar de onde parou (sincronizado entre os aparelhos)
- Modos: Direto -> Compativel (remux) -> Leve (transcode 720p/480p), com
  fallback automatico quando o navegador recusa o formato
- Botao Diagnostico: mostra peers, arquivo, codec, leitura e decisao

## Cache, limpeza e historico

- Os dados temporarios dos torrents ficam em ./downloads/<hash>.
- Ao remover um torrent ou limpar um torrent ocioso, o WebTorrent e instruido a apagar tambem os dados temporarios do disco.
- Torrents ociosos sao liberados automaticamente apos IDLE_MINUTES (padrao 1 min; minimo 1 min). O tempo e contado desde a ultima atividade do torrent.
- O historico de reproducao fica separado dos arquivos de video em ./data/progress.json. A interface mostra "Continuar assistindo" e "Ja assistidos", incluindo a posicao aproximada.
- O navegador mantem uma copia local do progresso para recuperar a posicao neste aparelho se o servidor reiniciar ou perder seu disco temporario. Para sincronizar entre aparelhos, o servidor precisa manter ./data em armazenamento persistente.
- A limpeza automatica se aplica aos dados de torrents que forem removidos depois desta atualizacao; pastas antigas ja existentes podem precisar de limpeza manual uma vez.

## Variaveis

PORT, DOWNLOAD_DIR, DATA_DIR, METADATA_TIMEOUT (120), IDLE_MINUTES (1),
TRANSCODE_PRESET (ultrafast em PC fraco), TRANSCODE_CRF, MAX_CONNS,
PROBE_BYTES, FFMPEG_PATH, FFPROBE_PATH, FFMPEG_DISABLE=1, QUIET=1, HTTPS=1.
