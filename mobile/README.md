# Lucky Mobile — fundação Android

Status: **estrutura inicial da interface; núcleo ainda não integrado**.

## Por que esta pasta existe

O repositório principal contém o Lucky 0.3.0 como núcleo CLI em TypeScript/Node.js. Ele usa módulos nativos do Node, incluindo `node:sqlite`, e inicializa por `src/cli.ts`. A ponte existente em `src/bridge/server.ts` foi criada para a extensão de PC e escuta exclusivamente em `127.0.0.1`; ela não é um serviço Android nem uma API de chat.

A aplicação `cloud/` também não substitui o núcleo local: seu próprio README declara que ela não executa ferramentas ou missões locais e não sincroniza o SQLite local.

Por isso, o APK não deve fingir que já controla o núcleo. Esta primeira etapa cria apenas a base nativa Android e deixa explícito o estado de integração.

## Decisões da fundação

- Aplicativo Android nativo em Kotlin + Jetpack Compose.
- Pacote: `com.edrielton.lucky`.
- Interface separada do núcleo, para permitir trocar o mecanismo de integração sem reescrever as telas.
- Nenhuma permissão de rede ou execução privilegiada nesta etapa.
- Nenhuma função de chat, memória, missão, ministro ou emergência é apresentada como operacional enquanto não existir integração real e testada.

## Próxima etapa técnica obrigatória

Antes de conectar a interface, escolher e validar como o núcleo será executado no Android sem exigir que o usuário abra o Termux. A implementação atual depende de Node.js >=22.18 e `node:sqlite`; simplesmente chamar a ponte de PC ou apontar para Lucky Cloud não preserva o comportamento do núcleo local.

A integração deve oferecer uma camada Android explícita para:
1. estado e inicialização do núcleo;
2. chat e provedor configurado;
3. missões e critérios;
4. memória estruturada e experiências;
5. auditoria e aprovações;
6. cancelamento/bloqueio seguro de operações.

A camada não pode contornar o Approval Gate, a política de ferramentas, a auditoria ou a sandbox. Ações sensíveis devem continuar exigindo aprovação humana.

## Build

Abra `mobile/android` no Android Studio com JDK 17 e Android SDK 35, ou execute com Gradle 8.9:

```sh
gradle :app:assembleDebug
```

O workflow `.github/workflows/android-debug-apk.yml` executa esse build em pushes que alterem `mobile/android/**` ou o próprio workflow e publica o APK debug como artefato de CI.

## Critérios de aceite da fundação

- Projeto Gradle reconhecido pelo Android Studio.
- APK debug compilado pelo CI.
- App abre sem crash e mostra claramente que o núcleo ainda não está conectado.
- Nenhuma tela simula respostas ou execuções do Lucky.
- Nenhuma alteração no núcleo existente ou nos dados do usuário.
