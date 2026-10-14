import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import frappeui from 'frappe-ui/vite';

// No Frappe site behind this app — the backend is Supabase — so the three
// sub-plugins that assume one are off (frappe-ui SETUP.md, "prototype" note).
export default defineConfig({
  // Served at /next/ alongside the React app until parity (nginx/frontend.conf).
  base: '/next/',
  plugins: [
    frappeui({ frappeProxy: false, jinjaBootData: false, buildConfig: false }),
    vue(),
  ],
});
