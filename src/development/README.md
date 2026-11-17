# Autocorreção supervisionada

O comando interativo `autocorrigir` chama `runSupervisedCorrection` e segue este fluxo:

1. Confirma que a raiz é um projeto `lucky` e cria uma cópia temporária, sem `.git`, `node_modules`, arquivos `.env*` ou links simbólicos.
2. Executa a suíte de testes existente. Se ela já passar, encerra sem solicitar ou aplicar mudanças.
3. Se houver falhas, envia ao modelo configurado um contexto limitado das fontes e do relatório de falhas, e aceita somente uma proposta JSON de tamanho limitado.
4. Exibe o resumo, os caminhos e o conteúdo da proposta. Só aplica a proposta na cópia depois da confirmação `EXECUTAR <12 primeiros caracteres do SHA-256>`, vinculada ao conteúdo exato revisado.
5. Executa novamente a suíte de testes, limitado a três tentativas.
6. Se os testes passarem, solicita a revisão humana `APROVAR <12 primeiros caracteres do SHA-256>` para a mesma proposta. Esta decisão não copia arquivos para o projeto original e não publica nada.

## Segurança e limitações

- O modelo não é obrigatório para o funcionamento normal do Lucky. Para gerar propostas de reparo é necessário configurar um provedor; a configuração recomendada sem API remota é um modelo local, por exemplo Ollama ou LM Studio.
- Cada etapa exibe e verifica o hash SHA-256 da proposta; qualquer divergência entre conteúdo apresentado e conteúdo executado cancela o ciclo.
- O fluxo automático não pode alterar testes, kernel de segurança, executor de testes, quality gate, metadados de dependências ou arquivos críticos de permissões da extensão; também não cria arquivos novos.
- A aprovação para executar uma proposta é separada da revisão final. Uma proposta recusada não é aplicada nem testada.
- Caminhos absolutos, traversal, links simbólicos, arquivos `.env*`, diretórios `.git`/`node_modules`, duplicatas e alterações em testes existentes são bloqueados. Há limites de quantidade e tamanho das mudanças e do contexto enviado ao modelo.
- A cópia temporária **não** constitui isolamento de sistema operacional. Após a confirmação `EXECUTAR`, código de teste alterado executa com as permissões da conta do usuário. Para código não confiável, use contêiner/VM ou usuário restrito antes de usar este ciclo.
- A cópia fica no diretório temporário para inspeção manual. Não há promoção, commit nem publicação automática.
