<script setup lang="ts">
import { computed } from 'vue';
import { NumberCard, DonutChart, BarChart } from 'frappe-ui/charts';
import { OUTCOME, type WidgetSpec } from '../dashboard/widgets';
import type { DashboardSummary } from '../lib/requests';

const props = defineProps<{ spec: WidgetSpec; summary: DashboardSummary | null; loading: boolean; error: string }>();

const s = computed(() => props.summary);
const err = computed(() => props.error || null);

// Zero slices are dropped (a 0% slice is noise), and the palette is built from the SAME
// filtered rows, so each outcome keeps its own colour however many are present.
const donutRows = computed(() => (props.spec.kind === 'donut' && s.value ? props.spec.rows(s.value).filter((r) => r.count > 0) : []));
const donutPalette = computed(() => donutRows.value.map((r) => r.color ?? '#2283c3'));
const barRows = computed(() => (props.spec.kind === 'bars' && s.value ? props.spec.rows(s.value) : []));

// Long data (one row per month and outcome) with `splitBy`, stacked — so the
// total height of a month is how many were filed, and each band is an outcome.
const trendRows = computed(() => (s.value ? s.value.by_month.flatMap((m) => [
  { month: m.month, outcome: OUTCOME.approved.label, count: m.approved },
  { month: m.month, outcome: OUTCOME.in_progress.label, count: m.in_progress },
  { month: m.month, outcome: OUTCOME.rejected.label, count: m.rejected },
]) : []));
const trendSeries = {
  [OUTCOME.approved.label]: { color: OUTCOME.approved.color },
  [OUTCOME.in_progress.label]: { color: OUTCOME.in_progress.color },
  [OUTCOME.rejected.label]: { color: OUTCOME.rejected.color },
};
// A time axis hands the formatter either a timestamp or a date string.
const monthFmt = (v: unknown) => {
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
};
// Counts of requests are whole numbers: drop the 0.5 ticks.
const wholeOnly = (v: unknown) => (Number.isInteger(Number(v)) ? String(v) : '');
const hasBars = computed(() => barRows.value.some((r) => r.count > 0));
const donutTotal = computed(() => donutRows.value.reduce((a, r) => a + r.count, 0));
const hasTrend = computed(() => trendRows.value.some((r) => r.count > 0));
</script>

<template>
  <div class="min-h-0 rounded-6 border bg-surface-base p-1">
    <template v-if="spec.kind === 'number'">
      <NumberCard
        :title="spec.title" :loading="loading" :error="err"
        :value="s ? spec.value(s) : null"
        :delta="s && spec.delta ? spec.delta(s) : undefined"
        :delta-suffix="spec.delta ? '%' : undefined"
        :delta-caption="spec.caption"
        :suffix="spec.suffix"
        :sparkline="s && spec.sparkline ? { data: spec.sparkline(s), type: 'bar' } : undefined"
        :card="false"
      />
    </template>

    <div v-else-if="spec.kind === 'donut'" class="h-72">
      <DonutChart
        :title="spec.title" :loading="loading" :error="err"
        :data="donutRows" category="name" value="count" :palette="donutPalette" :center-label="spec.center"
        :show-data-labels="false"
        :empty="donutTotal === 0"
      />
    </div>

    <div v-else-if="spec.kind === 'bars'" class="h-72">
      <p v-if="!loading && !err && !hasBars" class="p-4 pt-12 text-center text-p-sm text-ink-gray-5">
        <span class="mb-1 block text-base-medium text-ink-gray-8">{{ spec.title }}</span>{{ spec.empty }}
      </p>
      <BarChart
        v-else
        :title="spec.title" :subtitle="spec.subtitle" :loading="loading" :error="err"
        :data="barRows" x="name" y="count" horizontal :show-data-labels="true" :y-axis="{ format: wholeOnly }"
      />
    </div>

    <div v-else class="h-72">
      <p v-if="!loading && !err && !hasTrend" class="p-4 pt-12 text-center text-p-sm text-ink-gray-5">
        <span class="mb-1 block text-base-medium text-ink-gray-8">{{ spec.title }}</span>No requests in this period.
      </p>
      <BarChart
        v-else
        :title="spec.title" :subtitle="spec.subtitle" :loading="loading" :error="err"
        :data="trendRows" x="month" y="count" split-by="outcome" stacked :series-config="trendSeries"
        :x-axis="{ format: monthFmt }" :y-axis="{ format: wholeOnly }"
      />
    </div>
  </div>
</template>
