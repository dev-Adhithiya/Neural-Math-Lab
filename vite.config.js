import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devApiTarget = env.VITE_DEV_API_TARGET || 'http://localhost:8787';
  const appBasePath = env.VITE_BASE_PATH || '/';

  return {
    base: appBasePath,
    plugins: [react()],
    server: {
      port: 5173,
      open: true,
      proxy: {
        '/api': {
          target: devApiTarget,
          changeOrigin: true,
        },
      },
    },
    optimizeDeps: {
      exclude: ['@xenova/transformers'],
    },
    build: {
      target: 'esnext',
    },
  };
});
