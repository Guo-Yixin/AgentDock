import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['--test','tests/mysql.test.mjs'],{stdio:'inherit',env:{...process.env,AGENTDOCK_INTEGRATION:'true'}});child.on('exit',code=>process.exitCode=code);
