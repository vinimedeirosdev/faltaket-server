import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // O emulador é compartilhado: rodar os arquivos em série evita interferência.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
})
