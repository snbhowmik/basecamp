<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button, ErrorMessage, Badge } from 'frappe-ui';
import { getNotifications, markNotificationsSeen, describe, type NotificationFeed } from '../lib/notifications';
import { errorMessage } from '../lib/requests';

const emit = defineEmits<{ unread: [n: number] }>();

const feed = ref<NotificationFeed | null>(null);
const loading = ref(true);
const error = ref('');
// Unread is judged against the marker as it was when this tab loaded, so what was
// new stays visibly new for this visit even after it has been marked read.
const seenAt = ref<number>(0);

const unread = computed(() => (feed.value?.items ?? []).filter((n) => Date.parse(n.at) > seenAt.value).length);

onMounted(async () => {
  try {
    feed.value = await getNotifications(50);
    seenAt.value = feed.value.seen_at ? Date.parse(feed.value.seen_at) : 0;
    emit('unread', unread.value);
  } catch (e) { error.value = errorMessage(e, 'Could not load notifications.'); }
  finally { loading.value = false; }
});

async function markRead() {
  try { await markNotificationsSeen(); seenAt.value = Date.now(); emit('unread', 0); }
  catch (e) { error.value = errorMessage(e, 'Could not mark as read.'); }
}
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-p-sm text-ink-gray-5">Decisions on your requests, requests sent to you, and comments.</p>
      <Button v-if="unread" size="sm" @click="markRead">Mark all read</Button>
    </div>
    <ErrorMessage :message="error" />
    <p v-if="loading" class="py-10 text-center text-p-sm text-ink-gray-5">Loading…</p>
    <div v-else-if="!feed?.items.length" class="py-10 text-center">
      <div class="text-base-medium">Nothing yet</div>
      <p class="text-p-sm text-ink-gray-5">When a request of yours is decided, or one is sent to you, it shows up here.</p>
    </div>
    <ul v-else class="divide-y divide-outline-gray-1 rounded-6 border">
      <li v-for="n in feed.items" :key="n.id">
        <router-link
          :to="{ path: '/requests', query: { open: n.request_id } }"
          class="flex items-start gap-3 px-3 py-3 hover:bg-surface-gray-1"
          :class="Date.parse(n.at) > seenAt ? 'bg-surface-blue-2/40' : ''"
        >
          <span class="mt-1.5 size-2 flex-none rounded-full" :class="Date.parse(n.at) > seenAt ? 'bg-surface-blue-7' : 'bg-transparent'" :aria-label="Date.parse(n.at) > seenAt ? 'Unread' : ''" />
          <div class="min-w-0 flex-1">
            <div class="text-p-base text-ink-gray-8">{{ describe(n).text }}</div>
            <div v-if="n.detail && (n.kind === 'comment' || n.kind.startsWith('outcome'))" class="mt-0.5 truncate text-p-sm text-ink-gray-6">“{{ n.detail }}”</div>
            <div class="mt-0.5 flex items-center gap-2 text-xs text-ink-gray-5"><span class="font-mono">{{ n.reference }}</span><span>·</span><span>{{ when(n.at) }}</span></div>
          </div>
          <Badge :theme="describe(n).tone" :label="n.kind.startsWith('outcome') ? n.kind.split(':')[1].replace('_', ' ') : n.kind" />
        </router-link>
      </li>
    </ul>
  </section>
</template>
