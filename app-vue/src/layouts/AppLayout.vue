<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  DesktopShell, MobileShell, MobileNav, MobileNavItem, BottomSheet,
  Sidebar, SidebarHeader, SidebarItem, ScrollArea, Button, Avatar,
} from 'frappe-ui';
import { session } from '../lib/session';
import { signOut } from '../lib/auth';
import { useMediaQuery, SMALL_SCREEN_QUERY } from '../lib/useMediaQuery';

const route = useRoute();
const router = useRouter();
// Two navigation models, not one responsive component (frappe-ui): a sidebar on a
// wide screen, a bottom tab bar on a phone — the sidebar's full list moves into a
// BottomSheet behind the last tab.
const small = useMediaQuery(SMALL_SCREEN_QUERY);
const more = ref(false);

// Mirrors tabsFor() in the React AppShell. UX only; RLS decides access.
const tabs = computed(() => {
  const all = router.getRoutes().filter((r) => r.meta?.label);
  const byPath = (p: string) => all.find((r) => r.path === p);
  const ctx = session.ctx;
  const paths = ctx?.isCaptain
    ? ['/dashboard', '/hierarchy', '/workflow', '/templates', '/invite', '/accounts']
    : ['/dashboard', '/requests', '/hierarchy', ...(ctx?.isStaff ? ['/invite'] : [])];
  return paths.map(byPath).filter((r): r is NonNullable<typeof r> => !!r);
});
// The bar carries the first three; everything else, the account and sign-out live behind "You".
const barTabs = computed(() => tabs.value.slice(0, 3));
const name = computed(() => session.ctx?.profile.full_name ?? '');

async function logout() {
  more.value = false;
  await signOut();
  session.ctx = null;
  session.gate = 'login';
}
function go(path: string) { more.value = false; router.push(path); }
</script>

<template>
  <MobileShell v-if="small" class="bg-surface-base text-ink-gray-8">
    <router-view />

    <BottomSheet v-model:open="more" title="Menu">
      <div class="space-y-0.5 pb-6">
        <SidebarItem
          v-for="t in tabs" :key="t.path" :label="String(t.meta.label)" :icon="String(t.meta.icon)"
          :active="route.path === t.path" @click="go(t.path)"
        />
        <SidebarItem label="My account" icon="lucide-user" :active="route.path === '/account'" @click="go('/account')" />
        <div class="px-1 pt-3"><Button variant="subtle" class="w-full" @click="logout">Sign out</Button></div>
      </div>
    </BottomSheet>

    <template #nav>
      <MobileNav>
        <MobileNavItem v-for="t in barTabs" :key="t.path" :label="String(t.meta.label)" :icon="String(t.meta.icon)" :route="t.path" />
        <MobileNavItem label="You" :active="more" @click="more = true">
          <template #default="{ active }"><Avatar :label="name || 'You'" size="md" :class="active ? 'ring-2 ring-outline-gray-4' : ''" /></template>
        </MobileNavItem>
      </MobileNav>
    </template>
  </MobileShell>

  <div v-else class="h-screen w-full bg-surface-base text-ink-gray-8">
    <DesktopShell>
      <template #sidebar>
        <Sidebar width="14rem" class="border-r">
          <SidebarHeader title="BaseCamp" :subtitle="session.ctx?.profile.full_name" />
          <ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pt-0.5 pb-10">
            <div class="space-y-0.5">
              <SidebarItem
                v-for="t in tabs" :key="t.path" :label="String(t.meta.label)" :icon="String(t.meta.icon)"
                :route="t.path" :active="route.path === t.path"
              />
            </div>
          </ScrollArea>
          <div class="space-y-0.5 p-2">
            <SidebarItem label="My account" icon="lucide-user" route="/account" :active="route.path === '/account'" />
            <Button variant="ghost" class="w-full justify-start" @click="logout">Sign out</Button>
          </div>
        </Sidebar>
      </template>
      <router-view />
    </DesktopShell>
  </div>
</template>
