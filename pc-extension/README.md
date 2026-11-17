# Lucky para PC — extensão Chrome/Edge

## Instalação

1. Instale Node.js 22.18 ou superior e extraia o projeto Lucky.
2. No terminal, entre na pasta do projeto e execute `npm run bridge`.
3. Abra o arquivo `~/.lucky/bridge.token` no Windows; se `LUCKY_HOME` estiver configurado, use a pasta indicada por essa variável. Copie o token completo.
4. Abra `chrome://extensions` ou `edge://extensions`, ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione a pasta `pc-extension`.
5. Clique no ícone da extensão, cole o token no campo **Token da ponte local** e clique **Salvar token neste navegador**.
6. Abra uma página HTTP/HTTPS, clique no ícone da extensão e depois em **Enviar página ao Lucky**.

A ponte salva cada captura como JSON em `~/.lucky/inbox/`. A extensão não lê páginas em segundo plano, não captura campos de formulário e não executa comandos no computador. O conteúdo capturado é dado não confiável e não concede permissão para executar ações.
