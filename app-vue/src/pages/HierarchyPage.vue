<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { PageHeader, PageHeaderTitle, FormControl, Button, ErrorMessage } from 'frappe-ui';
import PersonCard from '../components/PersonCard.vue';
import {
  loadHierarchy, descendantOrgUnits, countStudents, fetchStudentPage, searchPeople,
  filterIsEmpty, EMPTY_FILTER,
  type HierarchySnapshot, type Position, type StudentRow, type StudentScope,
  type PeopleFilter, type PersonResult, type MemberType,
} from '../lib/hierarchy';
import type { OrgUnit, PriorityLevel } from '../lib/types';
import { errorMessage } from '../lib/requests';

// The organisation board — the authority ladder read top to bottom. One rung
// per priority level in rank order; choosing somebody narrows every rung beneath
// them to their people. The base rung can be 8,000+ students, so it opens as a
// handful and loads further pages of 100 on request rather than putting the
// whole cohort in the document.
const PAGE_SIZE = 100;
const PREVIEW = 8;

const snap = ref<HierarchySnapshot | null>(null);
const selected = ref<(Position | null)[]>([]);
const filter = ref<PeopleFilter>({ ...EMPTY_FILTER });
const card = ref<{ userId: string; name: string } | null>(null);
const showCard = ref(false);
const error = ref('');

onMounted(() => {
  loadHierarchy()
    .then((s) => { snap.value = s; selected.value = new Array(s.levels.length).fill(null); })
    .catch((e) => { error.value = errorMessage(e, 'Could not load the organisation.'); });
});

function openCard(userId: string, name: string) { card.value = { userId, name }; showCard.value = true; }

// The deepest selection above a rung decides what it shows.
function scopeFor(rung: number): { scope: StudentScope; label: string | null } {
  for (let i = rung - 1; i >= 0; i--) {
    const p = selected.value[i];
    if (!p) continue;
    if (p.sectionId) return { scope: { orgUnitIds: null, sectionId: p.sectionId }, label: p.fullName };
    if (p.orgUnitId) {
      return { scope: { orgUnitIds: descendantOrgUnits(snap.value!.orgUnits, p.orgUnitId), sectionId: null }, label: p.fullName };
    }
    return { scope: { orgUnitIds: null, sectionId: null }, label: p.fullName }; // holds a rung with no unit: the captain
  }
  return { scope: { orgUnitIds: null, sectionId: null }, label: null };
}

function inScope(p: Position, scope: StudentScope) {
  if (scope.sectionId) return p.sectionId === scope.sectionId;
  if (scope.orgUnitIds) return p.orgUnitId !== null && scope.orgUnitIds.includes(p.orgUnitId);
  return true;
}

function choose(rung: number, p: Position | null) {
  const next = selected.value.slice();
  next[rung] = p;
  for (let i = rung + 1; i < next.length; i++) next[i] = null; // those people may not be under them at all
  selected.value = next;
}

const rungs = computed(() => (snap.value?.levels ?? []).map((level, i) => {
  const { scope, label } = scopeFor(i);
  return {
    level, index: i, scope, label,
    people: level.is_base ? [] : snap.value!.positions.filter((p) => p.levelId === level.id && inScope(p, scope)),
  };
}));

const unitName = computed(() => {
  const m = new Map((snap.value?.orgUnits ?? []).map((u) => [u.id, u.name]));
  return (id: string | null) => (id ? m.get(id) ?? null : null);
});

// ── student rung ───────────────────────────────────────────────────────────
let run = 0;
const studentScopeKey = computed(() => {
  const base = rungs.value.find((r) => r.level.is_base);
  return base ? `${base.scope.sectionId ?? ''}|${(base.scope.orgUnitIds ?? []).join(',')}` : '';
});
const baseScope = computed(() => rungs.value.find((r) => r.level.is_base)?.scope ?? { orgUnitIds: null, sectionId: null });
const studentTotal = ref<number | null>(null);
const students = ref<StudentRow[]>([]);
const studentsOpen = ref(false);
const studentsErr = ref('');
const studentsBusy = ref(false);

async function loadStudents() {
  studentsBusy.value = true;
  const mine = run;
  try {
    const from = students.value.length;
    const { rows } = await fetchStudentPage(baseScope.value, from, from + PAGE_SIZE - 1);
    if (mine !== run) return;
    students.value = [...students.value, ...rows];
  } catch (e) { studentsErr.value = errorMessage(e, 'Could not load students.'); }
  finally { studentsBusy.value = false; }
}

// One watcher for both the first load and every scope change (a new scope is a
// different cohort). `run` discards a stale response if the scope moved on.
watch(() => [snap.value, studentScopeKey.value] as const, async ([s]) => {
  if (!s) return;
  const mine = ++run;
  students.value = []; studentTotal.value = null; studentsErr.value = ''; studentsOpen.value = false;
  try {
    const total = await countStudents(baseScope.value);
    if (mine !== run) return;
    studentTotal.value = total;
    await loadStudents();
  } catch (e) { if (mine === run) studentsErr.value = errorMessage(e, 'Could not load students.'); }
}, { immediate: true });

const shownStudents = computed(() => studentsOpen.value ? students.value : students.value.slice(0, PREVIEW));

// ── search ─────────────────────────────────────────────────────────────────
const searching = computed(() => !filterIsEmpty(filter.value));
const facetsOpen = ref(false);
const results = ref<PersonResult[]>([]);
const resultTotal = ref(0);
const resultBusy = ref(false);
const resultErr = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;

watch(filter, (f) => {
  clearTimeout(timer);
  if (filterIsEmpty(f)) return;
  resultBusy.value = true; resultErr.value = '';
  timer = setTimeout(() => { // a short pause so typing a register number is one query, not fifteen
    searchPeople(f, 50, 0)
      .then((r) => { results.value = r.rows; resultTotal.value = r.total; })
      .catch((e) => { resultErr.value = errorMessage(e, 'Could not search.'); })
      .finally(() => { resultBusy.value = false; });
  }, 250);
}, { deep: true });

const setFilter = (patch: Partial<PeopleFilter>) => { filter.value = { ...filter.value, ...patch }; };
const isStudent = computed(() => filter.value.memberType === 'student');
const isStaff = computed(() => filter.value.memberType === 'staff');
const narrowed = computed(() => [filter.value.orgUnitId, filter.value.batchId, filter.value.sectionId, filter.value.levelId].filter(Boolean).length);

const sel = (items: { id: string; name: string }[], any = 'Any') => [{ label: any, value: '' }, ...items.map((i) => ({ label: i.name, value: i.id }))];
const batches = computed(() => (snap.value?.batches ?? []).filter((b) => !filter.value.orgUnitId || b.org_unit_id === filter.value.orgUnitId));
const sections = computed(() => (snap.value?.sections ?? []).filter((s) =>
  filter.value.batchId ? s.batch_id === filter.value.batchId : batches.value.some((b) => b.id === s.batch_id)));
const batchOptions = computed(() => sel(batches.value.map((b) => ({
  id: b.id,
  // Every programme runs its own "2024-2028": name the programme only when the name alone doesn't settle it.
  name: batches.value.some((o) => o.id !== b.id && o.name === b.name) ? `${b.name} · ${unitName.value(b.org_unit_id) ?? '—'}` : b.name,
}))));
const placeholder = computed(() => isStudent.value ? 'Register number, name or email' : isStaff.value ? 'FET ID, name or email' : 'Register number, FET ID, name or email');
const toggleKind = (k: MemberType) => setFilter({ memberType: filter.value.memberType === k ? null : k, levelId: null, batchId: null, sectionId: null });
</script>

<template>
  <PageHeader><PageHeaderTitle title="Organisation" /></PageHeader>
  <div class="space-y-4 p-5">
    <p class="text-p-sm text-ink-gray-5">The ladder, read top to bottom. Choose somebody to narrow the rungs below them to their people.</p>
    <ErrorMessage :message="error" />
    <p v-if="!snap && !error" class="py-12 text-center text-p-sm text-ink-gray-5">Loading…</p>
    <p v-else-if="snap && !snap.levels.length" class="py-12 text-center text-p-sm text-ink-gray-5">
      No levels defined yet. The board draws one rung per priority level — create the ladder first and it fills in.
    </p>

    <template v-if="snap && snap.levels.length">
      <div class="space-y-3 rounded-6 border p-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" :variant="isStaff ? 'solid' : 'subtle'" @click="toggleKind('staff')">Staff</Button>
          <Button size="sm" :variant="isStudent ? 'solid' : 'subtle'" @click="toggleKind('student')">Students</Button>
          <div class="min-w-48 flex-1"><FormControl :model-value="filter.query" type="search" :placeholder="placeholder" @update:model-value="setFilter({ query: String($event ?? '') })" /></div>
          <Button v-if="searching" variant="ghost" @click="filter = { ...EMPTY_FILTER }">Clear</Button>
        </div>
        <button type="button" class="text-p-sm text-ink-gray-6 md:hidden" @click="facetsOpen = !facetsOpen">
          {{ narrowed > 0 ? `Narrowed by ${narrowed}` : 'Narrow it down' }}
        </button>
        <div class="grid-cols-2 gap-3 md:grid md:grid-cols-4" :class="facetsOpen ? 'grid' : 'hidden'">
          <FormControl type="select" label="Department" :model-value="filter.orgUnitId ?? ''" :options="sel(snap.orgUnits)"
                       @update:model-value="setFilter({ orgUnitId: $event || null, batchId: null, sectionId: null })" />
          <template v-if="!isStaff">
            <FormControl type="select" label="Batch" :model-value="filter.batchId ?? ''" :options="batchOptions"
                         @update:model-value="setFilter({ batchId: $event || null, sectionId: null })" />
            <FormControl type="select" label="Class" :model-value="filter.sectionId ?? ''" :options="sel(sections)"
                         @update:model-value="setFilter({ sectionId: $event || null })" />
          </template>
          <FormControl v-if="!isStudent" type="select" label="Role" :model-value="filter.levelId ?? ''"
                       :options="sel(snap.levels.filter((l: PriorityLevel) => !l.is_base))"
                       @update:model-value="setFilter({ levelId: $event || null })" />
        </div>
      </div>

      <!-- search results -->
      <div v-if="searching">
        <ErrorMessage :message="resultErr" />
        <p v-if="resultBusy" class="py-8 text-center text-p-sm text-ink-gray-5">Searching…</p>
        <div v-else-if="!results.length" class="py-8 text-center">
          <div class="text-base-medium">Nobody matches that</div>
          <div class="text-p-sm text-ink-gray-5">Try a shorter register number or FET ID, or widen the department.</div>
        </div>
        <div v-else class="rounded-6 border">
          <div class="border-b px-3 py-2 text-p-sm text-ink-gray-5">
            {{ resultTotal > results.length ? `${results.length} of ${resultTotal} people` : `${resultTotal} ${resultTotal === 1 ? 'person' : 'people'}` }}
          </div>
          <ul class="divide-y divide-outline-gray-1">
            <li v-for="r in results" :key="r.userId" class="flex items-center justify-between gap-3 px-3 py-2">
              <div class="min-w-0">
                <div class="text-base-medium">{{ r.fullName }}</div>
                <div class="truncate text-p-sm text-ink-gray-5">{{ [r.regNo ?? r.fetId, r.levelName, r.orgUnitName, r.sectionName].filter(Boolean).join(' · ') || r.email }}</div>
              </div>
              <Button variant="ghost" :aria-label="`Profile of ${r.fullName}`" @click="openCard(r.userId, r.fullName)"><span class="lucide-info size-4" aria-hidden="true" /></Button>
            </li>
          </ul>
          <p v-if="resultTotal > results.length" class="px-3 py-2 text-p-sm text-ink-gray-5">Narrow the search to see the rest — {{ resultTotal - results.length }} more match.</p>
        </div>
      </div>

      <!-- the ladder -->
      <div v-else class="space-y-6">
        <section v-for="r in rungs" :key="r.level.id" :aria-label="r.level.name" class="space-y-2">
          <div class="flex flex-wrap items-baseline gap-2">
            <h2 class="text-lg-semibold">{{ r.level.name }}</h2>
            <span class="text-p-sm text-ink-gray-5 tabular-nums">{{ r.level.is_base ? (studentTotal ?? '—') : r.people.length }}</span>
            <span v-if="r.label" class="text-p-sm text-ink-gray-5">under {{ r.label }}</span>
          </div>

          <template v-if="!r.level.is_base">
            <p v-if="!r.people.length" class="text-p-sm text-ink-gray-5">{{ r.label ? `Nobody at this level under ${r.label}.` : 'Nobody holds this level yet.' }}</p>
            <div v-else class="flex flex-wrap gap-2">
              <div
                v-for="p in r.people" :key="p.userId + p.levelId + (p.orgUnitId ?? '')"
                class="flex items-center rounded-5 border" :class="selected[r.index]?.userId === p.userId ? 'border-outline-blue-3 bg-surface-blue-2' : ''"
              >
                <button type="button" class="px-3 py-2 text-left" :aria-pressed="selected[r.index]?.userId === p.userId"
                        @click="choose(r.index, selected[r.index]?.userId === p.userId ? null : p)">
                  <div class="text-base-medium">{{ p.fullName }}</div>
                  <div class="text-p-sm text-ink-gray-5">{{ unitName(p.orgUnitId) ?? p.email }}</div>
                </button>
                <Button variant="ghost" :aria-label="`Profile of ${p.fullName}`" @click="openCard(p.userId, p.fullName)"><span class="lucide-info size-4" aria-hidden="true" /></Button>
              </div>
            </div>
          </template>

          <template v-else>
            <ErrorMessage :message="studentsErr" />
            <p v-if="studentTotal === 0 && !studentsErr" class="text-p-sm text-ink-gray-5">{{ r.label ? `No students under ${r.label}.` : 'No students have registered yet.' }}</p>
            <ul v-if="shownStudents.length" class="divide-y divide-outline-gray-1 rounded-6 border">
              <li v-for="s in shownStudents" :key="s.userId" class="flex items-center justify-between gap-3 px-3 py-2">
                <div><div class="text-base-medium">{{ s.fullName }}</div><div class="font-mono text-p-sm text-ink-gray-5">{{ s.regNo ?? '' }}</div></div>
                <Button variant="ghost" :aria-label="`Profile of ${s.fullName}`" @click="openCard(s.userId, s.fullName)"><span class="lucide-info size-4" aria-hidden="true" /></Button>
              </li>
            </ul>
            <div v-if="studentTotal !== null && studentTotal > PREVIEW" class="flex items-center gap-3">
              <Button v-if="!studentsOpen" @click="studentsOpen = true">Show all {{ studentTotal }} students</Button>
              <template v-else>
                <span class="text-p-sm text-ink-gray-5">{{ students.length }} of {{ studentTotal }} loaded</span>
                <Button v-if="students.length < studentTotal" :loading="studentsBusy" @click="loadStudents">Load {{ Math.min(PAGE_SIZE, studentTotal - students.length) }} more</Button>
              </template>
            </div>
          </template>
        </section>
      </div>
    </template>
  </div>
  <PersonCard v-if="card" v-model:open="showCard" :user-id="card.userId" :name="card.name" />
</template>
