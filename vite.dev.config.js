// Temporary dev-only config for the sandbox live preview (not part of the project).
// Binds all interfaces and allows the proxy hostname. Safe to delete.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { host: '0.0.0.0', port: 5173, allowedHosts: true } });
