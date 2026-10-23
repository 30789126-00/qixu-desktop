import { build } from 'esbuild';
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts','electron/overlay-preload.ts','electron/translation-worker.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, external: ['electron','@huggingface/transformers'] });
