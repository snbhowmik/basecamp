import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import frappeui from 'frappe-ui/vite';

// No Frappe site behind this app — the backend is Supabase — so the three
// sub-plugins that assume one are off (frappe-ui SETUP.md, "prototype" note).
export default defineConfig({
  plugins: [
    frappeui({ frappeProxy: false, jinjaBootData: false, buildConfig: false }),
    vue(),
  ],
});
