# Changelog — Cinep2p

## [Em andamento] — Catálogo TMDB e reprodução por magnet informado pelo usuário

### Alterações
- Adicionada a camada `src/catalog.js` para consultar o catálogo de filmes do TMDB usando a variável de ambiente `TMDB_API_KEY`.
- O catálogo retorna títulos, ano, nota, gêneros, sinopse, pôster e imagem de fundo. A busca usa o endpoint de pesquisa de filmes do TMDB.
- Adicionado `.env.example` sem segredo real. O arquivo `.env` permanece ignorado pelo Git.
- Atualizados os scripts `start` e `dev` para carregar opcionalmente o arquivo local `.env` com o Node.js.
- A interface de detalhes agora aceita um link magnet fornecido pelo usuário e valida um infohash v1 hexadecimal de 40 caracteres antes de iniciar a reprodução.
- A pesquisa de catálogo deixou de consultar o índice complementar de torrents. O endpoint legado `/api/extra` retorna uma resposta vazia e orienta o usuário a informar uma fonte autorizada.
- Mantida validação de hash na rota de streaming e adicionada mensagem de erro genérica para falhas de inicialização.
- Adicionada atribuição exigida para uso da API do TMDB na interface.

### Configuração
1. Criar uma chave de API no TMDB.
2. Copiar `.env.example` para `.env` e preencher `TMDB_API_KEY`.
3. Executar `npm start` ou `npm run dev` com Node.js 22.9 ou superior.
4. Testar `/api/catalog`, `/api/search?q=Batman`, a validação de magnet e a reprodução de um torrent autorizado.

### Testes e limitações
- **Não executados pelo agente:** testes automatizados, execução do servidor, chamadas reais ao TMDB e reprodução de mídia.
- A API real exige uma chave TMDB válida. Sem ela, o catálogo responde com erro de configuração em vez de apresentar filmes fictícios como se fossem reais.
- A reprodução requer um magnet válido e peers disponíveis; disponibilidade e compatibilidade de codecs dependem da fonte e do dispositivo.
- A chave TMDB deve ficar somente no arquivo local `.env`, nunca no JavaScript do navegador nem no Git.

