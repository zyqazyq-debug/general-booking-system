import { defineConfig, loadEnv } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');

  return {
    resolve: {
      alias: [
        {
          find: /^@\/components\//,
          replacement: `${path.resolve(__dirname, './src/shared/components')}/`,
        },
      ],
    },
    plugins: [
      uni(),
      {
        name: 'print-env-info',
        configureServer(server) {
          const _printUrls = server.printUrls;
          server.printUrls = () => {
            _printUrls.bind(server)();
            console.log('\n  --- 🌍 Frontend Environment Info ---');
            console.log(`  Mode:              ${mode}`);
            console.log(`  API Base URL:      ${env.VITE_API_BASE_URL}`);
            console.log(`  Bot Name:          @${env.VITE_TELEGRAM_BOT_NAME}`);
            console.log(
              `  Bot Display Name:  ${env.VITE_TELEGRAM_BOT_DISPLAY_NAME}`,
            );
            console.log('  ------------------------------------\n');
          };
        },
      },
    ],
    build: {
      // Uni-App's generated output must never accumulate stale hashed assets
      // across builds; release manifests bind exactly one clean build.
      emptyOutDir: true,
      // CI can request hidden source maps to prove that vulnerable compiler
      // packages did not enter the browser bundle. Production builds keep
      // source maps disabled.
      sourcemap: process.env.BOOKING_BUNDLE_AUDIT === 'true' ? 'hidden' : false,
    },
    envDir: path.resolve(__dirname, '..'), // Load .env from project root
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler', // or 'modern'
          silenceDeprecations: ['legacy-js-api'],
        },
      },
    },
    server: {
      host: '0.0.0.0', // Allow external access
      port: 8443, // Default port for dev
      strictPort: true, // Do not fallback when port is busy
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          // 关键修复：不要重写 /api，因为后端已经设置了 GlobalPrefix('api')
          // rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '^/[a-zA-Z0-9_-]{5,12}$': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          rewrite: (requestPath) => `/api/link/resolve/${requestPath.slice(1)}`,
          configure: (proxy, _options) => {
            proxy.on('proxyRes', (proxyRes, req, res) => {
              // Intercept 302 Redirect from backend and fix the Location header for local dev
              if (
                [301, 302, 307, 308].includes(proxyRes.statusCode || 0) &&
                proxyRes.headers.location
              ) {
                const targetUrl = new URL(
                  proxyRes.headers.location,
                  'http://localhost:8443',
                );
                proxyRes.headers.location = targetUrl.toString();
              }
            });
          },
        },
      },
    },
  };
});
