// Browser tests against a built page: WEB_SIM_BUILD names the build directory
// (build-test for make test, build for make smoke), served on a fixed port.
import { defineConfig } from '@playwright/test';

const dir = process.env.WEB_SIM_BUILD || 'build-test';

export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.mjs',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8766',
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `python3 -m http.server 8766 --bind 127.0.0.1 --directory ${dir}`,
    url: 'http://127.0.0.1:8766/picodeck_simulator.html',
    reuseExistingServer: false,
  },
});
