import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Em dev o painel fala com o backend local sem CORS
    proxy: { '/api': { target: 'http://127.0.0.1:3210', changeOrigin: true } },
  },
});
