import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Worker } from 'node:worker_threads';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const home = process.env.AGENTDOCK_HOME || homedir();
const port = Number(process.env.AGENTDOCK_PORT || 4317);
const config = {
  home, database: path.join(process.env.AGENTDOCK_DATA || path.join(root, 'data'), 'agentdock.sqlite'),
  codex: process.env.AGENTDOCK_CODEX_ROOT || path.join(home, '.codex'),
  claude: process.env.AGENTDOCK_CLAUDE_ROOT || path.join(home, '.claude'),
  cursor: process.env.AGENTDOCK_CURSOR_ROOT || path.join(home, 'AppData', 'Roaming', 'Cursor', 'User'),
};
const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: config });
const pending = new Map(); const streams = new Set(); let sequence = 0, workerError = null;
const ready = new Promise((resolve, reject) => {
  worker.on('message', message => {
    if (message.event === 'ready') resolve();
    if (message.event === 'update') for (const stream of streams) if (!stream.destroyed) stream.write(`event: update\ndata: ${Date.now()}\n\n`);
    if (message.id) { const entry = pending.get(message.id); if (!entry) return; clearTimeout(entry.timer); pending.delete(message.id); message.error ? entry.reject(new Error(message.error)) : entry.resolve(message.result); }
  });
  worker.on('error', error => { workerError = error; reject(error); for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); });
});
function rpc(method, args) {
  if (workerError) return Promise.reject(workerError);
  return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('采集服务响应超时，请重试')); }, 15000); pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, method, args }); });
}
const app = Fastify({ logger: false, bodyLimit: 128 * 1024 });
const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173']);
app.addHook('onRequest', async (request, reply) => {
  const host = request.headers.host?.split(':')[0];
  if (!['127.0.0.1', 'localhost'].includes(host)) return reply.code(403).send({ error: '仅允许本机访问' });
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return reply.code(403).send({ error: '请求来源不受信任' });
  if (request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: '仅允许本地同源请求' });
});
app.setErrorHandler((error, request, reply) => { reply.code(error.statusCode || 500).send({ error: error.validation ? '请求参数格式错误' : '本地服务暂不可用，请重试' }); });
app.get('/api/health', () => ({ ok: !workerError, version: '0.1.0' }));
app.get('/api/overview', async () => rpc('overview'));
app.get('/api/projects', async () => (await rpc('overview')).projects);
app.get('/api/sources', async () => (await rpc('overview')).sources);
app.get('/api/tasks', { schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 1000 }, provider: { type: 'string', maxLength: 30 }, project: { type: 'string', maxLength: 100 }, status: { type: 'string', maxLength: 30 }, page: { type: 'integer', minimum: 1, maximum: 100000 }, recent: { type: 'string', enum: ['true', 'false'] } } } } }, async request => rpc('list', { ...request.query, recent: request.query.recent === 'true' }));
app.get('/api/tasks/:id', async (request, reply) => { const task = await rpc('get', request.params.id); return task || reply.code(404).send({ error: '未找到该任务' }); });
app.patch('/api/tasks/:id', { schema: { body: { type: 'object', additionalProperties: false, properties: { note: { type: 'string', maxLength: 16000 }, summaryOverride: { anyOf: [{ type: 'string', maxLength: 16000 }, { type: 'null' }] }, manualStatus: { anyOf: [{ type: 'string', enum: ['unconfirmed', 'in_progress', 'blocked', 'done'] }, { type: 'null' }] }, goalGroup: { type: 'string', maxLength: 200 }, pinned: { type: 'boolean' } } } } }, async (request, reply) => {
  const patch = { ...request.body }; if ('goalGroup' in patch) patch.goalGroup = patch.goalGroup.trim();
  const task = await rpc('patch', { id: request.params.id, patch }); return task || reply.code(404).send({ error: '未找到该任务' });
});
app.get('/api/export', async (request, reply) => {
  const text = await rpc('export', request.query.task || null); if (text === null) return reply.code(404).send({ error: '未找到该任务' });
  return reply.type('text/markdown; charset=utf-8').header('Content-Disposition', 'attachment; filename="agentdock-summary.md"').send(text);
});
app.get('/api/events', async (request, reply) => {
  reply.hijack(); const stream = reply.raw;
  stream.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  stream.write('retry: 3000\nevent: update\ndata: connected\n\n'); streams.add(stream);
  const heartbeat = setInterval(() => { if (!stream.destroyed) stream.write(': heartbeat\n\n'); }, 15000);
  stream.on('close', () => { streams.delete(stream); clearInterval(heartbeat); });
});
const client = path.join(root, 'dist', 'client');
if (existsSync(client)) { await app.register(fastifyStatic, { root: client }); app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: '未知接口' }) : reply.sendFile('index.html')); }
else app.get('/', (_, reply) => reply.type('text/plain').send('AgentDock API 已启动。开发模式请打开 http://127.0.0.1:5173，或先 npm run build。'));
await ready;
try { await app.listen({ host: '127.0.0.1', port }); console.log(`AgentDock is ready at http://127.0.0.1:${port}`); }
catch (error) { await worker.terminate(); console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Set AGENTDOCK_PORT to another port.` : 'Unable to start AgentDock.'); process.exitCode = 1; }
async function shutdown() { for (const stream of streams) stream.end(); await app.close(); await worker.terminate(); }
process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown());
