# Lucky 0.3.0 — fundação de inteligência evolutiva

Lucky é um agente pessoal local. A versão 0.3.0 acrescenta uma primeira fundação determinística de inteligência evolutiva: raciocínio simbólico baseado em regras, planejamento por dependências e avaliação de estratégias com amostras mínimas. Esses mecanismos funcionam sem LLM ou API. O agente conversacional aberto e a execução de missões com interpretação flexível ainda podem usar um provedor opcional; não são substituídos por estes mecanismos.

## Requisitos

- Node.js 22.18 ou superior.
- Windows, Linux ou macOS para o núcleo CLI.
- Um modelo local compatível é opcional para execução de missões com raciocínio: Ollama ou servidor local compatível com a API OpenAI, como LM Studio/llama.cpp. O Lucky não precisa de chave de API remota.

## Instalação e execução

```bash
npm install
npm test
npm run selftest
npm start
```

O comando `inteligencia` funciona sem modelo e demonstra as capacidades determinísticas implementadas. O modo conversacional geral continua limitado sem provedor; o Lucky não finge compreender qualquer pedido sem essa capacidade. Para usar Ollama local, baixe e inicie um modelo no Ollama e rode:

```bash
LUCKY_PROVIDER=ollama LUCKY_MODEL=qwen3:4b npm start
```

No PowerShell do Windows:

```powershell
$env:LUCKY_PROVIDER="ollama"
$env:LUCKY_MODEL="qwen3:4b"
npm start
```

Para um servidor local compatível com OpenAI, defina `LUCKY_PROVIDER=openai`, `LUCKY_BASE_URL` e `LUCKY_MODEL`. `LUCKY_API_KEY` só é usada se o servidor configurado exigir chave; não é necessária para servidores locais usuais. Nenhuma API remota é configurada por padrão.

## Comandos do núcleo

- `status` — estado do agente e integridade da auditoria.
- `inteligencia` — demonstra raciocínio simbólico, planejamento e avaliação de estratégias sem modelo externo.
- `qualidade` (ou `qa`) — executa o portão de qualidade e registra cada resultado na auditoria.
- `autocorrigir` — testa uma cópia temporária e, se encontrar falhas, solicita uma proposta ao modelo configurado; exige confirmação explícita antes de testar o código proposto e revisão humana antes de encerrar. Nunca promove automaticamente alterações ao projeto original.
- `tarefas` — lista missões.
- `memória` — lista memórias estruturadas e a quantidade de experiências registradas.
- `lembrar <texto>` — grava uma memória confirmada pelo usuário.
- `aprender` — analisa experiências e registra padrões de falhas recorrentes; não altera código ou permissões.
- `sandbox` — verifica se Docker e a imagem local de execução isolada estão disponíveis.
- `desenvolva <objetivo>` — cria uma missão.
- `criterio <id> existe:<arquivo>` — exige que um arquivo exista no workspace.
- `criterio <id> contem:<arquivo>::<texto>` — exige conteúdo específico num arquivo.
- `criterio <id> cmd:<comando>` — verifica comando somente se estiver na allowlist automática.
- `execute missão <id>` — executa a missão com o modelo configurado, sujeito às políticas e aprovações.
- `concluir <id>` — conclusão manual explícita do usuário.
- `capturas` — lista páginas enviadas pela extensão.
- `captura <id>` — exibe o texto de uma captura.
- `sair` — encerra o processo.

A missão só é marcada `COMPLETED` quando todos os critérios verificáveis definidos pelo usuário passam. Missões sem critérios automáticos ficam aguardando revisão humana.

## Extensão para PC (Chrome/Edge)

1. Inicie a ponte local em outro terminal com `npm run bridge`.
2. Copie o token de `~/.lucky/bridge.token` (ou do diretório definido em `LUCKY_HOME`).
3. Abra `chrome://extensions` ou `edge://extensions`, ative o modo de desenvolvedor e carregue sem compactação a pasta `pc-extension`.
4. Abra a extensão, cole o token, salve e use **Enviar página ao Lucky** na página desejada.
5. No terminal do Lucky, use `capturas` e `captura <id>` para consultar o material recebido.

A extensão não monitora páginas em segundo plano, não coleta campos de formulário e não executa comandos. Conteúdo de páginas é entrada não confiável, não instrução privilegiada.

## Inteligência evolutiva (fundação 0.3.0)

- `src/intelligence/reasoning.ts`: inferência simbólica determinística com regras, variáveis, proveniência, limites de execução e detecção de conflitos em predicados configurados como exclusivos (por padrão, estado/status). Não assume que categorias múltiplas como “mamífero” e “animal” sejam contraditórias.
- `src/intelligence/planning.ts`: ordenação topológica de etapas, com detecção de dependências ausentes e ciclos. Planeja; não executa.
- `src/intelligence/evolution.ts`: compara estratégias usando taxas de sucesso e amostra mínima configurável. Uma melhoria candidata é apenas recomendada; nunca é ativada automaticamente.
- `src/memory/learning.ts`: identifica falhas operacionais recorrentes com evidências persistidas.

Estes componentes são uma base experimental e testável, não inteligência geral. Ainda não há compreensão aberta de linguagem natural, conselho de 17 ministros executável, aprendizagem neural própria ou autoalteração de código. Evolução de código continua submetida ao processo supervisionado e aos controles de segurança.

## Segurança e limitações

- `LUCKY_HOME` armazena banco, auditoria, token da ponte, capturas e backups; mantenha-o fora do workspace.
- O kernel e o agente ainda compartilham processo. A política de caminhos protege as ferramentas normais, mas não substitui isolamento por usuário, VM ou contêiner.
- Comandos fora da allowlist exigem aprovação explícita e são executados sem shell, mas ainda usam as permissões do usuário do sistema. Revise a ação antes de aprovar.
- A allowlist automática contém apenas `git status`, `git diff`, `git log` e `node --version`, sem argumentos extras.
- A ponte escuta somente em `127.0.0.1`, exige token, limita o corpo da requisição e salva arquivos com permissões restritas. Não exponha a porta em interfaces públicas.
- A extensão salva conteúdo em uma caixa de entrada local. Não significa que o modelo já tenha ingerido, resumido ou indexado automaticamente esse conteúdo.
- O hash encadeado da auditoria detecta alterações, mas não é uma defesa contra um atacante com controle completo da conta do sistema.
- Este é um MVP funcional, não um agente autônomo irrestrito nem um produto certificado para produção.

## Testes

- `npm test` executa a suíte de regressão do kernel, aprovação, auditoria, memória, missões e verificação de critérios.
- `npm run selftest` executa a suíte pelo executor local com timeout, limite de saída, ambiente filho sem variáveis comuns de segredos e sem shell. O comando interativo `autoteste` faz o mesmo e registra o resultado na auditoria.
- A memória estruturada diferencia tipos (episódica, semântica, procedural, projeto, pesquisa e sistema), confiança, fonte, tags e metadados. O histórico de experiências registra observações, erros, soluções e resultados.
- O Learning Engine identifica recorrências somente quando há evidências repetidas. Suas conclusões são observações com confiança `observed`; ele não altera código, objetivos, políticas ou permissões.
- O ciclo de autocorreção exige Docker e a imagem local `node:22.18-alpine`. Os testes experimentais rodam sem rede, com filesystem-base somente leitura, workspace isolado, usuário não-root, capacidades removidas e limites de CPU, RAM, PIDs, tempo e saída. O Lucky não baixa a imagem automaticamente e falha de forma fechada quando o backend não está disponível.
- `autocorrigir` integra o ciclo supervisionado ao CLI. Quando os testes já passam, nenhuma alteração é proposta. Quando falham, exige um provedor de modelo, mostra os arquivos propostos e exige `EXECUTAR <hash>` vinculado ao SHA-256 da proposta antes de aplicar a proposta na cópia temporária e executar testes. Após aprovação dos testes, exige `APROVAR <hash>` para revisão final; isso não altera o projeto original. O ciclo bloqueia mudanças em testes, kernel de segurança, executor/quality gate, metadados do projeto e arquivos críticos da extensão; também bloqueia criação de arquivos no fluxo automático.
- `npm run qa` executa o portão de qualidade: requisito mínimo do Node.js, suíte de regressão, verificação de tipos, sintaxe da extensão de PC e validação do Manifest V3. Se uma verificação obrigatória falhar ou o Node estiver abaixo de 22.18, o portão reprova a versão.
- O executor informa aprovação/reprovação, código de saída, duração e saída dos testes; não presume sucesso se o processo falhar ou exceder o tempo.
- **Limite de segurança:** `npm run selftest` e `autoteste` executam a suíte localmente e não são sandbox do sistema operacional. A execução de código experimental pelo fluxo `autocorrigir` é separada e exige o backend Docker; não aprove código não confiável fora desse fluxo isolado.

## Integridade dos arquivos críticos (0.2.6)

Antes de iniciar o núcleo, o Lucky compara hashes SHA-256 de arquivos críticos com o manifesto incluído nesta distribuição. Se detectar arquivo ausente, substituído ou alterado, o CLI encerra a inicialização. Você também pode verificar manualmente com:

```powershell
npm run verify:integrity
```

Essa proteção é **detecção de adulteração**, não DRM nem isolamento inviolável. Como esta distribuição contém código-fonte, uma pessoa experiente que consiga editar o programa pode tentar alterar tanto a verificação quanto o manifesto. Para resistir a um adversário com controle administrativo, é necessário distribuir um binário assinado e validar a assinatura com uma chave pública confiável fora do alcance do usuário comum, além de usar permissões do Windows. Não compartilhe esta versão como impossível de modificar.

## Preparar sandbox isolada no Windows

1. Instale e inicie o Docker Desktop, usando contêineres Linux.
2. Em um terminal, obtenha manualmente a imagem oficial usada pelo executor: `docker pull node:22.18-alpine`.
3. No diretório do Lucky, execute `npm start` e use o comando `sandbox`.
4. Só execute `autocorrigir` quando o comando `sandbox` indicar que Docker e a imagem local estão disponíveis.

O Lucky não baixa imagens automaticamente. O contêiner de testes não recebe acesso à rede; o download manual da imagem ocorre antes da execução. A disponibilidade do Docker não substitui a revisão humana nem torna o sistema invulnerável.
