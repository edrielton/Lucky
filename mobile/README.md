# Lucky Mobile — fundação Android + teste AICore

Status: interface Android com teste de inferência local AICore; núcleo principal ainda não integrado.

## Teste AICore / Gemini Nano

A tela Chat inclui um teste explícito usando a API oficial ML Kit GenAI Prompt (com.google.mlkit:genai-prompt). O app:
- cria um cliente Generation.getClient() com configuração padrão estável;
- consulta checkStatus() antes de inferir;
- só chama generateContent() quando o estado é AVAILABLE;
- não inicia download automático;
- apresenta estados indisponível, baixável, baixando e erro;
- não executa ferramentas, missões nem ações do Lucky.

O POCO X8 Pro consta na documentação do Google como compatível com acesso direto ao Gemini Nano 2 e fluxos de agentes. A versão efetivamente disponibilizada depende também da configuração de RAM, versão do Android e estado do AICore. A versão efetivamente carregada pelo cliente precisa ser confirmada no aparelho.

## Por que esta pasta existe

O repositório principal contém o Lucky 0.3.0 como núcleo CLI em TypeScript/Node.js. Ele usa módulos nativos do Node, incluindo node:sqlite, e inicializa por src/cli.ts. A ponte existente em src/bridge/server.ts foi criada para a extensão de PC e escuta exclusivamente em 127.0.0.1; ela não é um serviço Android nem uma API de chat.

A aplicação cloud/ também não substitui o núcleo local: seu próprio README declara que ela não executa ferramentas ou missões locais e não sincroniza o SQLite local.

Por isso, o APK não deve fingir que já controla o núcleo. O teste AICore é apenas uma validação isolada da capacidade de inferência local.

## Decisões da fundação

- Aplicativo Android nativo em Kotlin + Jetpack Compose.
- Pacote: com.edrielton.lucky.
- Interface separada do núcleo.
- Nenhuma permissão de execução privilegiada.
- Nenhuma função de memória, missão, ministro ou emergência é apresentada como operacional sem integração real e testada.
- A inferência AICore é executada no dispositivo, enquanto o app está em primeiro plano.

## Build

Abra mobile/android no Android Studio com JDK 17 e Android SDK 35, ou execute com Gradle 8.9:

    gradle :app:assembleDebug

O workflow .github/workflows/android-debug-apk.yml executa esse build em pushes que alterem mobile/android/** ou o próprio workflow e publica o APK debug como artefato de CI.

## Critérios de aceite desta etapa

- Projeto Gradle reconhecido pelo Android Studio.
- APK debug compilado pelo CI.
- App abre e mostra claramente que o núcleo ainda não está conectado.
- Tela Chat verifica o estado do AICore antes de enviar um prompt.
- Nenhuma missão, ferramenta ou ação do Lucky é executada pelo modelo.
