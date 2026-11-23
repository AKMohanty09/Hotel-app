import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  let disableViteClientWs = false;
  return {
    plugins: [
      {
        name: 'disable-vite-client-ws-when-hmr-off',
        apply: 'serve' as const,
        configResolved(resolvedConfig) {
          disableViteClientWs =
            resolvedConfig.server.hmr === false ||
            resolvedConfig.server.ws === false;
        },
        transform(code, id) {
          if (!disableViteClientWs) return;
          const startMarker = 'const transport = normalizeModuleRunnerTransport(';
          const endMarker = '\nlet willUnload = false;';
          if (
            id.includes('vite/dist/client/client.mjs') &&
            code.includes(startMarker)
          ) {
            const startIdx = code.indexOf(startMarker);
            const endIdx = code.indexOf(endMarker, startIdx);
            if (startIdx !== -1 && endIdx !== -1) {
              const noopTransport =
                'const transport = normalizeModuleRunnerTransport({\n  async connect() {},\n  async disconnect() {},\n  send() {},\n});';
              return {
                code:
                  code.slice(0, startIdx) +
                  noopTransport +
                  code.slice(endIdx),
                map: null,
              };
            }
          }
        },
      },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: 'Saffron & Hearth OS',
          short_name: 'SaffronPOS',
          description:
            'Complete restaurant management, permanent table QR ordering, waiter service, and kitchen display platform.',
          theme_color: '#0F172A',
          background_color: '#F8FAFC',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,woff2}'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/api\//],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      hmr: process.env.DISABLE_HMR !== 'true',
      ws: process.env.DISABLE_HMR === 'true' ? false : undefined,
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
