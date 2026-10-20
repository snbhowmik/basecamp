<script setup lang="ts">
import { computed, ref } from 'vue';
import { TabButtons } from 'frappe-ui';
import AppHeader from '../components/AppHeader.vue';
import NotificationsTab from '../components/NotificationsTab.vue';
import PendingTab from '../components/PendingTab.vue';
import SummaryTab from '../components/SummaryTab.vue';
import AnalyticsTab from '../components/AnalyticsTab.vue';
import { session } from '../lib/session';

// Everyone gets the three personal tabs: what's new (notifications), what's still
// open (pending requests) and how their requests turned out (summary). People who
// decide things — staff and the captain — also get Analytics: the same OD numbers,
// scoped by the database to what each can see. The captain opens on Analytics,
// everyone else on Pending. All tabs stay mounted (v-show) so each loads once and
// can report its count to the tab label.
const ctx = computed(() => session.ctx!);
const showAnalytics = computed(() => ctx.value.isCaptain || ctx.value.isStaff);

type Tab = 'analytics' | 'notifications' | 'pending' | 'summary';
const tab = ref<Tab>(ctx.value.isCaptain ? 'analytics' : 'pending');

const unread = ref(0);
const pending = ref(0);

const options = computed(() => [
  ...(showAnalytics.value ? [{ label: 'Analytics', value: 'analytics' }] : []),
  { label: unread.value ? `Notifications (${unread.value})` : 'Notifications', value: 'notifications' },
  { label: pending.value ? `Pending requests (${pending.value})` : 'Pending requests', value: 'pending' },
  { label: 'Request summary', value: 'summary' },
]);
const firstName = computed(() => ctx.value.profile.full_name.split(' ')[0]);
</script>

<template>
  <AppHeader title="Dashboard" />
  <div class="space-y-5 px-3 pb-10 pt-5 sm:px-5">
    <p class="text-p-base text-ink-gray-7">Welcome back, {{ firstName }}.</p>
    <TabButtons v-model="tab" :options="options" />

    <AnalyticsTab v-if="showAnalytics" v-show="tab === 'analytics'" />
    <NotificationsTab v-show="tab === 'notifications'" @unread="unread = $event" />
    <PendingTab v-show="tab === 'pending'" @count="pending = $event" />
    <SummaryTab v-show="tab === 'summary'" />
  </div>
</template>
