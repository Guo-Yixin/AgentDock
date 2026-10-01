import { parentPort, workerData } from 'node:worker_threads';
import { openStore } from './store.mjs';
import { Collector } from './collector.mjs';
const store = openStore(workerData.database);
let lastNotice = 0;
const collector = new Collector(store, workerData, () => {
  if (Date.now() - lastNotice > 600 || !collector.progress.active) { lastNotice = Date.now(); parentPort.postMessage({ event: 'update' }); }
});
parentPort.on('message', async ({ id, method, args }) => {
  try {
    let result;
    if (method === 'overview') result = store.overview(collector.sources, collector.progress);
    else if (method === 'list') result = store.list(args);
    else if (method === 'get') result = store.get(args);
    else if (method === 'patch') result = store.patch(args.id, args.patch);
    else if (method === 'export') result = store.export(args);
    else if (method === 'stop') { collector.stop(); store.close(); parentPort.postMessage({ id, result: true }); return; }
    else throw new Error('Unknown worker method');
    parentPort.postMessage({ id, result });
    if (method === 'patch') parentPort.postMessage({ event: 'update' });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
parentPort.postMessage({ event: 'ready' });
void collector.start().catch(() => parentPort.postMessage({ event: 'update' }));
