# Lucky — MVP 0.1 (núcleo em terminal)

Agente pessoal local, em terminal, com núcleo de segurança e missões verificáveis.
Este MVP implementa os passos 1–3 do roteiro: **núcleo + kernel de segurança + modelo trocável + missões/memória**.

## Rodar

Requer Node ≥ 22.18 (usa `node:sqlite` e executa TypeScript direto).

```bash
npm install            # só para typecheck (typescript, @types/node)
npm test               # 9 testes do kernel, aprovação, auditoria, loop e verificação
npm start              # CLI (sem modelo = modo limitado, nada é inventado)

# com modelo local:
LUCKY_PROVIDER=ollama LUCKY_MODEL=qwen2.5:7b npm start
# ou servidor compatível com OpenAI (llama.cpp server, LM Studio):
LUCKY_PROVIDER=openai LUCKY_BASE_URL=http://localhost:8080/v1 npm start
```

Variáveis: `LUCKY_WORKSPACE` (pasta onde o agente trabalha, padrão `./workspace`), `LUCKY_HOME` (dados do Lucky, padrão `~/.lucky`, **tem de ficar fora do workspace**), `LUCKY_MODE` (`plan` | `ask` | `auto`).

## Comandos

`status` · `tarefas` · `memória` · `lembrar <texto>` · `desenvolva <objetivo>` · `criterio <id> existe:<arq> | contem:<arq>::<texto> | cmd:<comando>` · `execute missão <id>` · `concluir <id>` · `sair`

Fluxo: `desenvolva` cria a missão → **você** define os critérios de aceitação → `execute missão` roda o agente → o código verifica os critérios. Só vira `COMPLETED` se todos passarem. Sem critérios, fica `AWAITING_APPROVAL` (revisão humana).

## Decisões que fecham as lacunas do Documento Mestre

| Lacuna | Decisão no MVP |
|---|---|
| Inteligência trocável | Interface `ModelProvider`: Ollama, OpenAI-compatível (llama.cpp) e `NullProvider` (modo limitado). Remoto é opcional, nunca obrigatório. |
| Contrato de ferramenta | `Tool` em `src/types.ts` (nome, schema, risco, permissões declaradas). As ~420 integrações entram por aqui. |
| Kernel não alterável pelo agente | Dados em `LUCKY_HOME` **fora** do workspace; caminhos validados com `realpath` (bloqueia `..` e symlink). |
| Aprovação do que foi revisado | Aprovação presa ao **hash** de (ferramenta + argumentos), uso único. Conteúdo mudou → nova aprovação. |
| Prompt injection | Saída de ferramenta é embrulhada como dado; o prompt manda ignorar ordens dentro dela; ações de risco passam pelo gate de qualquer forma. |
| Verificação | Critérios checados por código (arquivo existe/contém, comando com exit 0). Só o **usuário** define critérios — o agente não consegue afrouxar a própria verificação. |
| Memória | SQLite com nível `observed` / `inferred` / `confirmed` e fonte. |
| Auditoria | Cadeia de hashes: adulterar um registro quebra `status` → "integridade QUEBRADA". |
| Recuperação | `write_file` copia o arquivo anterior para `LUCKY_HOME/backups` antes de sobrescrever. |
| Comandos | Sem shell; metacaracteres (`; & \| > < $` e crase) negados; lista de bloqueio; só `git status/diff/log` e `node --version` rodam sem perguntar. |

## Limites conhecidos (honestidade)

- **Kernel no mesmo processo do agente.** Hoje o isolamento é por política de caminhos. O endurecimento real é rodar o Security Kernel como **processo separado**, com outro usuário do sistema e código somente leitura (passo seguinte).
- **Sandbox de autodesenvolvimento ainda não existe.** Plano: `git worktree` numa pasta isolada + container/WSL2 para executar o código gerado, aprovação do diff por hash.
- `run_command` fora da lista segura roda no seu sistema após aprovação — leia o comando antes de aceitar.
- Qualidade depende do modelo local; modelos pequenos erram em chamada de ferramenta. Teste com o seu hardware antes de confiar em missões longas.

## Roteiro

1. ✅ Núcleo CLI, kernel, aprovação por hash, auditoria encadeada
2. ✅ Adaptador de modelo trocável
3. ✅ Missões com critérios verificáveis + memória com confiança
4. ⏭ Autodesenvolvimento: sandbox (worktree + container), plugins em pasta separada, aprovação de diff
5. Lucky PC (Windows): ponte em `localhost` com token, sem admin
6. Extensão Chrome/Edge (conteúdo de página = dado, nunca ordem)
7. Android como controle remoto; voz
8. Camada de integrações (MCP) com roteamento por domínio, para as ~420
