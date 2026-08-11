import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

// `.mts` because the package is CommonJS — a `.ts` config would be loaded as CJS
// and Vite warns that its ESM syntax will stop working in a future major.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Tests are colocated with the code they cover (`src/**/*.test.ts`) so they are
// linted and type-checked by the existing tooling for free. `tsconfig.build.json`
// keeps them out of `dist/`.
//
// Vite's alias matcher is prefix-aware, so a bare `~` resolves `~/api/...`
// without pulling in `vite-tsconfig-paths`.
//
// This file sits outside `tsconfig.json`'s `include` (which is `["src"]` with
// `rootDir: ./src`, so adding it would break the build's rootDir contract).
// It is not covered by `yarn typecheck` — but Vite type-strips and loads it on
// every `yarn test`, so a mistake here fails immediately rather than silently.
export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(rootDir, 'src')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: [path.resolve(rootDir, 'vitest.setup.mts')]
  }
});
