import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // `vite preview` rejects unexpected Host headers; the emulator loads the host
  // machine via 10.0.2.2, so the Host check is disabled for this loopback-bound
  // dev/preview server.
  preview: {
    allowedHosts: true,
  },
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            // The SDK is ~1 MB and only loaded (dynamic import in daemon-client/sdk.ts)
            // once the user connects; it must stay out of index.html's preload list.
            {
              name: 'daemon-sdk',
              test: /[\\/]node_modules[\\/]@factory[\\/]droid-sdk/,
            },
          ],
        },
      },
    },
  },
});
