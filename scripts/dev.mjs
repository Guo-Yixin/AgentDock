import { spawn } from 'node:child_process';
const server = spawn(process.execPath, ['--watch', 'server/index.mjs'], { stdio: 'inherit', windowsHide: true });
const client = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', windowsHide: true });
let closing = false;
function stop() { if (closing) return; closing = true; server.kill(); client.kill(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.on('exit', stop); client.on('exit', stop);
