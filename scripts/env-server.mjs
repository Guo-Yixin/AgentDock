import {testStore} from '../tests/mysql-helper.mjs';
import {spawn} from 'node:child_process';
import path from 'node:path';
const {store,config}=await testStore('agentdock_e2e_initialize');
try{for(const table of ['ad_sessions','ad_users','ad_usage','ad_goal_sessions','ad_goals','ad_annotations','ad_events','ad_checkpoints','ad_tasks','ad_documents','ad_schema_migrations'])await store.rows('DROP TABLE '+table);}finally{await store.close();}
const env={...process.env,AGENTDOCK_DATA:path.resolve('artifacts/e2e/initialize'),AGENTDOCK_HOME:path.resolve('artifacts/e2e/empty-home'),AGENTDOCK_PORT:'4320'};
for(const field of ['host','port','user','password','database','tls'])env['AGENTDOCK_MYSQL_'+field.toUpperCase()]=String(config[field]);
for(const id of ['CODEX','CLAUDE','CURSOR','PI','HARNESS','WORKBUDDY'])env['AGENTDOCK_'+id+'_ROOT']=path.join(env.AGENTDOCK_HOME,id.toLowerCase());
for(const key of ['AGENTDOCK_DEEPSEEK_API_KEY','DEEPSEEK_API_KEY','AGENTDOCK_SESSION_TOKEN','AGENTDOCK_DESKTOP'])delete env[key];
const child=spawn(process.execPath,['server/index.mjs'],{env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());child.on('exit',code=>process.exitCode=code||0);
