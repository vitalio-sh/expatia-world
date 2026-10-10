import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {cloudflare} from '@cloudflare/vite-plugin';
import {sites} from './scripts/hosting/sites-vite-plugin';
export default defineConfig({plugins:[react(),sites({mockAuth:false}),cloudflare({viteEnvironment:{name:'server'},inspectorPort:false,config:{name:'expatia-world',main:'./src/server/worker.ts',compatibility_date:'2026-10-10',compatibility_flags:['nodejs_compat'],assets:{binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*','/realtime']}}})],build:{outDir:'dist'}});
