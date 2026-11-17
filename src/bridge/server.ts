import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const home = path.resolve(process.env.LUCKY_HOME ?? path.join(os.homedir(), '.lucky'));
const port = Number(process.env.LUCKY_BRIDGE_PORT ?? '43127');
const tokenPath = path.join(home, 'bridge.token');
fs.mkdirSync(home, { recursive: true, mode: 0o700 });
if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
const token = fs.readFileSync(tokenPath, 'utf8').trim();
const inbox = path.join(home, 'inbox'); fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
const json = (req: http.IncomingMessage, res: http.ServerResponse, status: number, body: unknown) => {
  const origin = req.headers.origin ?? '';
  const cors = origin.startsWith('chrome-extension://') ? origin : 'null';
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': cors, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
  res.end(JSON.stringify(body));
};
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': req.headers.origin?.startsWith('chrome-extension://') ? req.headers.origin : 'null', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); return res.end(); }
  if (req.url !== '/v1/capture' || req.method !== 'POST') return json(req, res, 404, { error: 'Rota não encontrada' });
  const auth = req.headers.authorization ?? '';
  const supplied = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
  const expected = Buffer.from(token);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(req, res, 401, { error: 'Token inválido' });
  const origin = req.headers.origin ?? '';
  if (origin && !origin.startsWith('chrome-extension://')) return json(req, res, 403, { error: 'Origem não permitida' });
  let body = ''; let size = 0;
  req.on('data', chunk => { size += chunk.length; if (size > 30000) { json(req, res, 413, { error: 'Conteúdo excede 30 KB' }); req.destroy(); } else body += chunk.toString('utf8'); });
  req.on('end', () => {
    try {
      const input = JSON.parse(body);
      if (typeof input.title !== 'string' || typeof input.url !== 'string' || typeof input.text !== 'string') return json(req, res, 400, { error: 'title, url e text são obrigatórios' });
      const url = new URL(input.url);
      if (!['http:', 'https:'].includes(url.protocol)) return json(req, res, 400, { error: 'URL inválida' });
      const id = `${Date.now()}-${randomBytes(4).toString('hex')}`;
      const record = { id, receivedAt: new Date().toISOString(), title: input.title.slice(0, 300), url: url.href.slice(0, 2000), text: input.text.slice(0, 20000) };
      fs.writeFileSync(path.join(inbox, `${id}.json`), JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
      return json(req, res, 201, { ok: true, id });
    } catch { return json(req, res, 400, { error: 'JSON inválido' }); }
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Lucky PC bridge ativo em http://127.0.0.1:${port}; token: ${tokenPath}`));
