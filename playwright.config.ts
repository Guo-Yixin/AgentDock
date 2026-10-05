import { defineConfig } from '@playwright/test';
// Local services must bypass a developer machine's outbound HTTP proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
export default defineConfig({
  testDir: './tests/browser',globalSetup:'./tests/browser/setup.ts', fullyParallel: false, workers: 1, timeout: 30000,
  reporter: 'list', outputDir: 'artifacts/browser-results',
  use: { baseURL: 'http://127.0.0.1:4318', storageState:'artifacts/e2e/auth-state.json', browserName: 'chromium', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [{ command: 'node scripts/test-server.mjs', url: 'http://127.0.0.1:4318/api/health', reuseExistingServer: false, timeout: 30000 }, {command:'node scripts/empty-server.mjs',url:'http://127.0.0.1:4319/api/health',reuseExistingServer:false,timeout:30000},{command:'node scripts/env-server.mjs',url:'http://127.0.0.1:4320/api/health',reuseExistingServer:false,timeout:30000}],
});
