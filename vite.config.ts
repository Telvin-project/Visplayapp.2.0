import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'node:fs';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  // Vite copies public/ to the distributed app. Fail the build if someone has
  // placed a legacy unprotected movie in a public folder by mistake.
  const containsFilesOrLinks = (directory: string): boolean => fs.readdirSync(directory, { withFileTypes: true })
    .some(entry => !entry.isDirectory() || containsFilesOrLinks(path.join(directory, entry.name)));
  for (const directory of ['public/uploads', 'public/videos']) {
    const absolute = path.resolve(import.meta.dirname, directory);
    if (fs.existsSync(absolute) && containsFilesOrLinks(absolute)) {
      throw new Error(`Private media security: migrate any legacy uploaded assets out of the web build input (${directory}) before building.`);
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
