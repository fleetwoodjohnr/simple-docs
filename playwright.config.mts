import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  // On CI, failures also become GitHub annotations, which are public (job logs need sign-in).
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: { trace: 'retain-on-failure' }
})
