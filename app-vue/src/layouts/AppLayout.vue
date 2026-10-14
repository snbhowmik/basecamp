<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DesktopShell, Sidebar, SidebarHeader, SidebarItem, ScrollArea, Button } from 'frappe-ui';
import { session } from '../lib/session';
import { signOut } from '../lib/auth';

const route = useRoute();
const router = useRouter();

// Mirrors tabsFor() in the React AppShell. UX only; RLS decides access.
const tabs = computed(() => {
  const all = router.getRoutes().filter((r) => r.meta?.label);
  const byPath = (p: string) => all.find((r) => r.path === p);
  const paths = session.ctx?.isCaptain
    ? ['/dashboard', '/hierarchy']
    : ['/dashboard', '/requests', '/hierarchy'];
  return paths.map(byPath).filter((r): r is NonNullable<typeof r> => !!r);
});

async function logout() {
  await signOut();
  session.ctx = null;
  session.gate = 'login';
}
</script>

<template>
  <div class="h-screen w-full bg-surface-base text-ink-gray-8">
    <DesktopShell>
      <template #sidebar>
        <Sidebar width="14rem" class="border-r">
          <SidebarHeader title="BaseCamp" :subtitle="session.ctx?.profile.full_name" />
          <ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pt-0.5 pb-10">
            <div class="space-y-0.5">
              <SidebarItem
                v-for="t in tabs"
                :key="t.path"
                :label="String(t.meta.label)"
                :icon="String(t.meta.icon)"
                :to="t.path"
                :active="route.path === t.path"
              />
            </div>
          </ScrollArea>
          <div class="p-2">
            <Button variant="ghost" class="w-full justify-start" @click="logout">Sign out</Button>
          </div>
        </Sidebar>
      </template>
      <router-view />
    </DesktopShell>
  </div>
</template>
