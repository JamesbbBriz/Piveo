import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const authTarget = env.VITE_AUTH_PROXY_TARGET || 'http://localhost:3101';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // 开发环境通过同源代理绕过浏览器 CORS：
        // 使用 VITE_API_BASE_URL=/api 且 VITE_API_PROXY_TARGET=https://n.lconai.com
        proxy: {
          '/auth': {
            target: authTarget,
            changeOrigin: true,
            secure: false,
          },
          '/api': {
            // /api 请求统一先进入本地 auth server，由服务端注入上游 Authorization。
            target: authTarget,
            changeOrigin: true,
            secure: false,
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
