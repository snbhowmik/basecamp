import { createRouter, createWebHistory } from 'vue-router';

// Route guards live in App.vue's gate, not here: whether you may see a page
// depends on the async sign-in/MFA state, and RLS is the real boundary anyway.
// /verify is public by design (PRD.md §14.4) and sits outside the gate.
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: () => import('./pages/DashboardPage.vue'), meta: { label: 'Dashboard', icon: 'lucide-layout-dashboard' } },
    { path: '/requests', component: () => import('./pages/RequestsPage.vue'), meta: { label: 'Requests', icon: 'lucide-inbox' } },
    { path: '/invite', component: () => import('./pages/InvitePage.vue'), meta: { label: 'Invite', icon: 'lucide-user-plus' } },
    { path: '/accounts', component: () => import('./pages/AccountsPage.vue'), meta: { label: 'Accounts', icon: 'lucide-users' } },
    { path: '/hierarchy', component: () => import('./pages/ComingPage.vue'), meta: { label: 'Organisation', icon: 'lucide-network' } },
    { path: '/register', component: () => import('./pages/RegisterPage.vue'), meta: { public: true } },
    { path: '/invite/:token', component: () => import('./pages/AcceptInvitePage.vue'), meta: { public: true } },
    { path: '/verify/:code?', component: () => import('./pages/VerifyPage.vue'), meta: { public: true } },
    { path: '/:rest(.*)*', redirect: '/dashboard' },
  ],
});
