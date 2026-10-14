<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import DashboardWidget from './DashboardWidget.vue';
import { WIDGETS, DEFAULT_LAYOUT, type WidgetSpec } from '../dashboard/widgets';
import { getDashboardSummary, errorMessage, type DashboardSummary } from '../lib/requests';
import { session } from '../lib/session';

// An analytics view of OD requests. Every number comes from one RPC that runs as
// the signed-in user, so row-level security scopes it: the captain sees the whole
// instance, a dean the programmes under them, a mentor what they can see.
const summary = ref<DashboardSummary | null>(null);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try { summary.value = await getDashboardSummary(12); }
  catch (e) { error.value = errorMessage(e, 'Could not load the dashboard.'); }
  finally { loading.value = false; }
});

// Today the default layout; a per-user layout would replace DEFAULT_LAYOUT with that person's saved list of widget ids.
const layout = computed<WidgetSpec[]>(() =>
  DEFAULT_LAYOUT.map((id) => WIDGETS.find((w) => w.id === id)).filter((w): w is WidgetSpec => !!w));
const spanClass = (n: number) => ({ 1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-3', 4: 'lg:col-span-4' } as Record<number, string>)[n];
const scope = computed(() => session.ctx!.isCaptain ? 'the whole instance' : 'everything you can see');
</script>

<template>
  <div class="space-y-4">
    <p class="text-p-sm text-ink-gray-5">OD requests across {{ scope }}.</p>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="w in layout" :key="w.id" class="sm:col-span-1" :class="spanClass(w.span)">
        <DashboardWidget :spec="w" :summary="summary" :loading="loading" :error="error" />
      </div>
    </div>
  </div>
</template>
