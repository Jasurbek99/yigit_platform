import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    include: [
      'antd',
      '@ant-design/icons',
      '@ant-design/pro-components',
    ],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        // Force IPv4 — Node on Windows resolves `localhost` to ::1 first,
        // where a separate WordPress dev server (php.exe) is bound and
        // returns 404 HTML for our /api/v1/* paths. Django listens on
        // 0.0.0.0 (IPv4), so 127.0.0.1 hits the correct process.
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        // Use the http:// scheme even for WS targets — Vite's underlying
        // http-proxy-middleware does the upgrade itself when ws:true; passing
        // ws:// here breaks the connection on some platforms.
        target: 'http://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
