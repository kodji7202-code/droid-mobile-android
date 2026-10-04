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
});
