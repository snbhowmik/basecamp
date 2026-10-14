import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './style.css';
import './documents.css';
import './bencho.css';

createApp(App).use(router).mount('#app');
