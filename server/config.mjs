import { existsSync, realpathSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (existsSync('.env')) process.loadEnvFile('.env');
export const dataDir = path.resolve(process.env.AGENTDOCK_DATA || 'data');
const file = path.join(dataDir, 'settings.local.json');
export function loadSettings() { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { sources: {}, model: 'deepseek-flash' }; } }
export function saveSettings(value) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(file + '.tmp', file);
}
export function protect(value, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('此平台请使用环境变量配置凭据');
  // A fixed script receives secrets through stdin, never through command arguments.
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=${decrypt ? '[Convert]::FromBase64String($v)' : '[Text.Encoding]::UTF8.GetBytes($v)'}; $r=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${decrypt ? '[Text.Encoding]::UTF8.GetString($r)' : '[Convert]::ToBase64String($r)'})`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: value, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.status !== 0) throw new Error('Windows 凭据加密操作失败，请重新配置');
  return decrypt ? result.stdout : result.stdout.trim();
}
export function mysqlConfig(settings = loadSettings()) {
  const keys = ['HOST', 'PORT', 'USER', 'PASSWORD', 'DATABASE'];
  const present = keys.filter(k => Boolean(process.env['AGENTDOCK_MYSQL_' + k]));
  if (present.length) {
    if (present.length !== keys.length || keys.some(k => !process.env['AGENTDOCK_MYSQL_' + k])) throw new Error('MySQL 环境变量必须完整配置主机、端口、用户、密码和数据库');
    return validateDatabase({ host: process.env.AGENTDOCK_MYSQL_HOST, port: Number(process.env.AGENTDOCK_MYSQL_PORT), user: process.env.AGENTDOCK_MYSQL_USER, password: process.env.AGENTDOCK_MYSQL_PASSWORD, database: process.env.AGENTDOCK_MYSQL_DATABASE, tls: process.env.AGENTDOCK_MYSQL_TLS ? process.env.AGENTDOCK_MYSQL_TLS !== 'false' : undefined, ca: process.env.AGENTDOCK_MYSQL_CA || '' });
  }
  if (!settings.database?.passwordEncrypted) return null;
  return validateDatabase({ ...settings.database, password: protect(settings.database.passwordEncrypted, true) });
}
export function validateDatabase(input) {
  if (!input || typeof input.host !== 'string' || !input.host.trim() || !Number.isInteger(Number(input.port)) || Number(input.port) < 1 || Number(input.port) > 65535 || typeof input.user !== 'string' || !input.user || typeof input.password !== 'string' || !input.password || !/^[\w-]{1,64}$/.test(input.database || '')) throw new Error('请完整填写有效的数据库配置');
  return { host: input.host.trim(), port: Number(input.port), user: input.user, password: input.password, database: input.database, tls: input.tls ?? !['localhost', '127.0.0.1', '::1'].includes(input.host.trim()), ca: typeof input.ca === 'string' ? input.ca : '' };
}
export function modelKey(settings = loadSettings()) { return process.env.AGENTDOCK_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || (settings.keyEncrypted ? protect(settings.keyEncrypted, true) : ''); }
export function publicSettings(settings = loadSettings()) {
  let db = null, issue = ''; try { db = mysqlConfig(settings); } catch (e) { issue = e.message; }
  let hasKey = false; try { hasKey = Boolean(modelKey(settings)); } catch { issue ||= '模型凭据无法解密'; }
  return { database: db ? { host: db.host, port: db.port, user: db.user, database: db.database, tls: db.tls, ca: db.ca, hasPassword: true } : null, databaseFromEnv: Boolean(process.env.AGENTDOCK_MYSQL_HOST), hasKey, keyFromEnv: Boolean(process.env.AGENTDOCK_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY), model: settings.model || 'deepseek-flash', sources: discoverSources(settings), issue };
}
export function discoverSources(settings = loadSettings()) {
  const home = process.env.AGENTDOCK_HOME || homedir();
  const definitions = { codex: ['Codex / Codex CLI', 'CODEX_HOME', path.join(home, '.codex')], claude: ['Claude Code / CLI', 'CLAUDE_CONFIG_DIR', path.join(home, '.claude')], cursor: ['Cursor', '', path.join(process.env.AGENTDOCK_HOME ? path.join(home, 'AppData', 'Roaming') : process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'User')], pi: ['Pi CLI', 'PI_CODING_AGENT_DIR', path.join(home, '.pi', 'agent')], deepseek: ['DeepSeek Harness', 'DSH_HOME', path.join(home, '.dsh')], workbuddy: ['WorkBuddy', '', path.join(home, '.workbuddy')] };
  return Object.entries(definitions).map(([id, [name, env, fallback]]) => {
    const override = process.env[`AGENTDOCK_${id === 'deepseek' ? 'HARNESS' : id.toUpperCase()}_ROOT`];
    const saved = settings.sources?.[id]; const tool = env && process.env[env];
    const resolved = path.resolve(override || saved?.root || tool || fallback); const root = existsSync(resolved) ? realpathSync.native(resolved) : resolved;
    const command = id === 'deepseek' ? 'dsh' : id === 'workbuddy' ? 'workbuddy' : id;
    const executable = (process.env.PATH || '').split(path.delimiter).flatMap(dir => ['', '.exe', '.cmd', '.ps1'].map(ext => path.join(dir, command + ext))).find(existsSync) || '';
    return { id, name, root, exists: existsSync(root), executable, enabled: saved?.enabled !== false, discoveredBy: override ? 'AgentDock 环境变量' : saved?.root ? '用户配置' : tool ? env : '当前用户默认目录' };
  });
}
