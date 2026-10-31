import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served at /rfold/ next to the default Vue app at the root (nginx/frontend.conf).
  base: '/rfold/',
  plugins: [react()],
});
