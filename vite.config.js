import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ server: { allowedHosts: true }, preview: { allowedHosts: true }, plugins: [react()], build: { rollupOptions: { input: { main: 'index.html', careers: 'careers.html', portal: 'portal.html' }, output: { manualChunks: { react: ['react','react-dom'], database: ['@supabase/supabase-js'] } } } } });
