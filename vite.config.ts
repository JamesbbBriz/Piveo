import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // 开发环境通过同源代理绕过浏览器 CORS：
        // 使用 VITE_API_BASE_URL=/api 且 VITE_API_PROXY_TARGET=https://n.lconai.com
        proxy: {
          '/api': {
            target: env.VITE_API_PROXY_TARGET || 'https://n.lconai.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api/, ''),
          },
        },
      },
      plugins: [react()],
      // Keep legacy process.env injection for any remaining code paths.
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
