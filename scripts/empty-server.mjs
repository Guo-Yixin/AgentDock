import {spawn} from 'node:child_process';import path from 'node:path';
const env={...process.env,AGENTDOCK_PORT:'4319',AGENTDOCK_DATA:path.resolve('artifacts/e2e/empty-data'),AGENTDOCK_HOME:path.resolve('artifacts/e2e/empty-home')};for(const k of Object.keys(env))if(k.startsWith('AGENTDOCK_MYSQL_')||k.includes('DEEPSEEK_API_KEY'))delete env[k];
const child=spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',env});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());child.on('exit',code=>process.exitCode=code||0);
