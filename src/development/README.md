# Lucky — Autodesenvolvimento supervisionado via Git

O módulo `src/development/repository.ts` transforma uma base demonstrativa em um ciclo operacional para alterações no próprio repositório:

1. inspeciona o checkout e verifica estado limpo;
2. executa a suíte base;
3. recebe uma proposta técnica estruturada;
4. cria uma branch `lucky/*` a partir de `main`;
5. aplica somente alterações permitidas na cópia/branch isolada;
6. executa testes reais;
7. calcula um diff e dois hashes: proposta e diff;
8. exige aprovação explícita para publicar;
9. cria um commit local;
10. envia somente a branch aprovada ao GitHub;
11. nunca faz merge automático em `main`.

Proteções atuais:

- recusar checkout sujo ou branch principal como branch ativa;
- impedir nome de branch principal;
- bloquear `.git`, `node_modules`, arquivos `.env*`, segurança, testes e metadados críticos;
- bloquear traversal, links simbólicos e arquivos protegidos;
- limitar uma proposta a 30 arquivos e 1 MB por arquivo;
- não publicar se o usuário negar a aprovação;
- não publicar se os testes ainda falharem.

Limitação atual:

- a publicação padrão executa `git push`; ela não cria pull request nem faz merge.
- um provedor externo pode gerar a proposta, mas o candidato sempre passa pelas verificações e aprovações locais.
