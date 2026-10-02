import mysql from 'mysql2/promise';
import { mysqlConfig } from '../server/config.mjs';
import { connectionOptions, openStore } from '../server/store.mjs';
export async function testStore(name) {
  if (!/^agentdock_(test|e2e|ci)[a-z0-9_]*$/.test(name)) throw new Error('拒绝操作非测试数据库');
  const config = mysqlConfig(); if (!config) throw new Error('集成测试需要完整 MySQL 环境变量或本地配置');
  const connection = await mysql.createConnection({ ...connectionOptions(config), database: undefined });
  try { await connection.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4`); } finally { await connection.end(); }
  const store = await openStore({ ...config, database: name }, true);
  for (const table of ['ad_tasks','ad_events','ad_checkpoints','ad_annotations','ad_documents']) await store.rows('DELETE FROM ' + table);
  return { store, config: { ...config, database: name } };
}
