import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { rollupOptions: { input: { main: 'index.html', careers: 'careers.html' }, output: { manualChunks: { react: ['react','react-dom'], database: ['@supabase/supabase-js'] } } } } });
