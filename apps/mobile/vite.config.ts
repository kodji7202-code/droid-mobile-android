import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // `vite preview` rejects unexpected Host headers; the emulator loads the host
  // machine via 10.0.2.2, so the Host check is disabled for this loopback-bound
  // dev/preview server (see services.yaml comment on the `web` service).
  preview: {
    allowedHosts: true,
  },
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            // The SDK (+ the daemon-client adapter that wraps it) is ~1 MB;
            // keep it in its own cacheable chunk (architecture.md 3.2).
            {
              name: 'daemon-sdk',
              test: /[\\/]node_modules[\\/]@factory[\\/]droid-sdk|packages[\\/]daemon-client[\\/]/,
            },
          ],
        },
      },
    },
  },
});
