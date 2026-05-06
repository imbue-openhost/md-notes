import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:9000';

export default defineConfig({
  testDir: './playwright_tests',
  timeout: 30000,
  use: {
    baseURL,
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
