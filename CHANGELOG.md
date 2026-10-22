# Changelog — Cinep2p

Este arquivo registra alterações relevantes, decisões técnicas, testes e pendências do projeto. Cada entrada deve distinguir fatos confirmados de hipóteses e informar quando os testes não foram executados.

## [Em andamento] — 2026-10-22 — Diagnóstico inicial e recuperação segura

### Contexto confirmado
- A branch local informada pelo desenvolvedor estava em `main`, sincronizada com `origin/main`, no commit `7dc383d` (`feat: miniaturas e capas reserva em todo o catalogo`).
- `server.js` importa `listMovies` e `searchMovies` de `src/yts.js`.
- O endpoint `GET /api/poster?title=...` já existe e usa `searchMovies(title)` para procurar uma capa.
- O endpoint `GET /api/catalog` usa `listMovies(...)`; `GET /api/search` combina resultados de `searchMovies` com resultados da busca complementar.
- A versão atual de `src/yts.js` contém 12 filmes de demonstração e gera capas SVG para esses itens. A busca local filtra apenas essa lista, portanto títulos ausentes nela, como Batman ou Moana, não são encontrados por essa função.
- Uma versão anterior de `src/yts.js` foi extraída do primeiro pai do stash para `src/yts-restaurado.tmp.js`. Essa versão usa `https://yts.mx/api/v2`, normaliza capas remotas e constrói links magnet a partir dos dados retornados.
- Foi relatada falha de resolução DNS para `yts.mx`. Em teste anterior relatado na conversa, uma solicitação para `yts.am` respondeu com dados; isso ainda não comprova disponibilidade consistente nem compatibilidade de todos os endpoints.
- O stash `stash@{0}` permanece preservado. Ele contém alterações em `public/app.js` e `src/yts.js`.
- O `package.json` consultado localmente declara os scripts `start` e `dev`; não foi identificado um script de testes npm.

### Arquivos/áreas inspecionados
- `src/yts.js` — implementação atual baseada em demonstração.
- `src/yts-restaurado.tmp.js` — extração temporária da versão anterior para comparação; não deve ser incorporada ao repositório.
- `server.js` — endpoints de catálogo, busca e capas.
- `package.json` — scripts disponíveis.
- Estado Git local — havia alterações staged e unstaged em `src/yts.js`, além de arquivos temporários e um arquivo com nome estranho na raiz.

### Decisões e cuidados
- Não executar `git reset`, `git stash pop` ou `git stash drop` durante a recuperação sem revisar previamente o impacto.
- Não usar `git add .` enquanto houver arquivos temporários ou alterações sem relação com a tarefa.
- Preservar o contrato de dados consumido por `server.js` e pela interface ao corrigir a busca.
- Validar os serviços externos antes de depender deles; uma resposta isolada não garante disponibilidade.
- Manter a busca de metadados/capas separada da origem dos vídeos e utilizar fontes autorizadas.
- O arquivo temporário de recuperação e os backups locais não devem ser enviados ao GitHub.

### Testes
- **Executados/confirmados:** inspeção do código e do estado Git por comandos PowerShell fornecidos pelo desenvolvedor; consulta anterior relatada a `/api/search?q=Moana`, sem resultados YTS na implementação de demonstração.
- **Não executados nesta etapa:** testes automatizados, teste de integração depois da correção, e validação HTTP atual de `/api/catalog`, `/api/search` e `/api/poster`.
- **Resultado:** diagnóstico documentado; nenhuma correção de código da integração foi aplicada nesta entrada.

### Próximas etapas
1. Rever as alterações locais staged/unstaged e manter intactos os arquivos do usuário.
2. Implementar uma camada de busca de metadados/capas com endpoint validado e timeout, preservando um fallback de demonstração.
3. Adicionar testes automatizados para normalização de dados, fallback e respostas sem capa.
4. Validar os endpoints localmente, documentar resultados reais e somente então criar um commit específico para a correção.

---

## Modelo para novas entradas

Para cada alteração, registrar:
- Data e identificador.
- Objetivo e motivo.
- Arquivos alterados e resumo preciso.
- Comportamento antes/depois.
- Comandos de teste e resultados observados.
- Limitações ou pendências.
- Hash e mensagem do commit, quando houver.
