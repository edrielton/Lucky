# Lucky Cloud 0.1 (fundação inicial)

Esta camada é isolada do Lucky local 0.3.0. O Worker, a interface e a base D1 não importam nem abrem o SQLite local; não há migração local nem execução de comandos, ferramentas ou missões no Worker.

## Requisitos e preparação

- Node.js 22.18+ para executar os testes.
- Conta Cloudflare com Workers, D1 e, opcionalmente, Workers AI habilitados.
- Wrangler instalado no ambiente de desenvolvimento (não é dependência do núcleo local).

Na raiz do repositório, crie o banco e substitua `REPLACE_WITH_D1_DATABASE_ID` em `cloud/wrangler.jsonc` pelo ID retornado:

```sh
npx wrangler d1 create lucky-cloud
npx wrangler d1 migrations apply lucky-cloud --local
npx wrangler d1 migrations apply lucky-cloud --remote
npx wrangler dev --config cloud/wrangler.jsonc
npx wrangler deploy --config cloud/wrangler.jsonc
```

O diretório `web/` é servido como Static Assets. A primeira conta é criada por autoatendimento; não há conta administrativa ou senha padrão. Em produção, use HTTPS e limite a criação de contas no nível da plataforma se o serviço não for público.

Os dados da Cloud usam exclusivamente o binding D1 `DB`. O binding `AI` habilita Workers AI; escolha um provedor na interface para usar o chat. Sem binding ou provedor selecionado, o chat retorna `503` explicitamente. Nenhuma chave de API é solicitada no navegador. Segredos para futuros provedores externos devem ser configurados como secrets do Worker e não como dados da interface.

## Testes

```sh
npm --prefix cloud test
npx tsc --noEmit -p cloud/tsconfig.json
npm test
npm run typecheck
```

Os testes Cloud usam o `node:sqlite` apenas como adaptador D1 de teste, não fazem parte do Worker e não acessam o banco local. A aplicação real precisa ser validada com Wrangler/D1 em desenvolvimento antes da implantação.

## Superfície implementada

- Contas com PBKDF2-HMAC-SHA-256 (600.000 iterações), sessões opacas com hash no D1, cookie `HttpOnly; Secure; SameSite=Strict`, proteção de origem/CSRF e limitação de tentativas.
- Consultas de missões, memórias, experiências, aprovações, chat e auditoria sempre filtradas por proprietário; foreign keys removem dados da conta ao apagá-la.
- Aprovações com hash canônico de usuário, ferramenta, argumentos e contexto; validade de 10 minutos, decisão única e consumo condicional de uso único. Esta versão não oferece executor de ferramentas.
- Auditoria por usuário com encadeamento SHA-256, verificação de lacunas/conteúdo e gravação concorrente protegida por sequência única. É detecção de adulteração, não armazenamento imutável nem proteção contra controle administrativo do D1.
- Interface responsiva; saída de usuário é inserida como texto, sem HTML executável.
- Configuração opcional de Workers AI, sem credenciais no navegador. O modelo não recebe ferramentas.

## Limitações e critérios pendentes

- A implementação é uma fundação de MVP, não satisfaz ainda todos os critérios de produção da proposta.
- A auditoria do núcleo confirma que Lucky 0.3.0 **não define identidades nem responsabilidades aprovadas de 17 ministros** e declara o conselho executável como não implementado. A interface deixa isso explícito; nenhum ministro foi inventado ou contado como concluído.
- O chat Cloud é uma integração opcional de Workers AI, não uma extração completa do raciocínio ou planejamento local. O código simbólico local não foi alterado.
- Missões são registradas e consultadas, não planejadas ou executadas. O Worker não executa comandos, ferramentas, Docker, arquivos locais, nem sincroniza a memória local.
- A tabela de aprendizagem pode expor insights, mas o fluxo de análise da aprendizagem local ainda não foi portado para D1.
- Não há criação/gestão de provedores arbitrários, armazenamento de chaves de terceiros, exportação/exclusão de conta por API, MFA, verificação de e-mail, nem política de retenção. Contas podem ser removidas por operações administrativas no D1; a cadeia de auditoria não é inviolável contra tais operações.
- A validação automatizada não comprova implantação real no Cloudflare, concorrência distribuída em produção, política de billing, disponibilidade, ou revisão independente de segurança. Não declarar a versão aprovada antes de executar a suíte Cloud, a regressão e os testes de D1 remoto controlado.
