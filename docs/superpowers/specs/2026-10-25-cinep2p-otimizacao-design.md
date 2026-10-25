# Otimização do CineP2P

## Intenção

Melhorar o tempo de resposta e a previsibilidade do CineP2P, reduzir acúmulo de arquivos temporários e manter o repositório organizado. O aplicativo atual usa Node.js/Express, scraper com concorrência limitada, cache em memória e disco, catálogo persistido em JSON e player com verificações periódicas.

## Objetivos

- Evitar ciclos simultâneos e reduzir o tempo do aquecimento do catálogo com concorrência limitada.
- Evitar que o cache TMDb descarte todos os resultados de uma vez e evitar chamadas duplicadas simultâneas.
- Reduzir trabalho repetido no player e revisar cabeçalhos/rotinas de cache com foco em carga e uso de disco.
- Impedir que backups e artefatos locais reapareçam como arquivos pendentes do Git.
- Preservar os contratos atuais das rotas e a experiência do usuário.

## Fora de escopo

- Atualizar dependências para novas versões principais.
- Apagar ou mover `data/`, `cache/`, `.cache/`, `downloads/`, `certs/` ou `.env`.
- Alterar o funcionamento do streaming, fontes ou filtros sem uma causa concreta identificada.
- Apagar cópias de backup enquanto a revisão automática de segurança continuar bloqueando a remoção.

## Abordagens consideradas

1. **Ajustes locais:** corrigir somente a agenda do worker e o cache TMDb. Tem risco menor, mas deixa pontos de trabalho repetido e organização do repositório sem revisão.
2. **Revisão ampla em etapas (escolhida):** revisar worker, cache, rotinas do player e regras para arquivos temporários; aplicar apenas mudanças pequenas e localizadas, preservando APIs e configuração atual. Cobre os três objetivos pedidos com mudanças mais fáceis de revisar.
3. **Refatoração geral:** reorganizar módulos, alterar dependências e reestruturar o fluxo de busca/player. Amplia o risco e dificulta identificar qual mudança trouxe benefício.

## Plano de implementação

- Tornar o agendamento do worker não sobreposto e avaliar concorrência limitada entre consultas, preservando tratamento isolado de falhas.
- Substituir a limpeza total do cache TMDb por expiração/evicção gradual com limite definido e coalescência de chamadas idênticas em andamento.
- Examinar as verificações do player para evitar sondagens repetidas quando o estado já é conhecido, sem prejudicar recuperação de reprodução.
- Ajustar `.gitignore` para padrões explícitos de backups e artefatos locais, preservando arquivos de exemplo e conteúdo versionado.
- Só alterar rotinas de cache em disco quando o limite e a regra puderem ser demonstrados com o código atual; manter `data/`, `cache/` e downloads intactos.

## Restrições e verificação

- Mudanças incrementais e localizadas; sem dependências novas nem alteração de comportamento público.
- Não adicionar ou executar testes sem solicitação. Fazer revisão do diff e verificações estáticas compatíveis com os comandos existentes.
- A remoção local de backups permanece pendente: a tentativa via PowerShell foi bloqueada pela revisão automática e não foi contornada.

## Decisões deixadas ao implementador

Escolher limites conservadores a partir das configurações existentes, manter os valores configuráveis e não elevar concorrência ou limites de memória sem evidência no fluxo atual.
