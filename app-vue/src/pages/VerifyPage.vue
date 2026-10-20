<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Button, FormControl, ErrorMessage } from 'frappe-ui';
import { supabase } from '../lib/supabase';
import StampMark from '../components/StampMark.vue';
import Brand from '../components/Brand.vue';
import { decorativeBars } from '../lib/barcode';

interface Sig { signer: string; role: string; stage: string; signed_at: string }
interface Result { found: boolean; intact?: boolean; doc_type?: string; issued_at?: string; signatures?: Sig[] | null }

const route = useRoute();
const input = ref(String(route.params.code ?? ''));
const result = ref<Result | null>(null);
const error = ref('');
const loading = ref(false);

async function run() {
  result.value = null;
  error.value = '';
  if (!input.value.trim()) return;
  loading.value = true;
  try {
    const { data, error: err } = await supabase.rpc('verify_document', { p_reference_code: input.value.trim() });
    if (err) throw err;
    result.value = data as Result;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not check that code.';
  } finally {
    loading.value = false;
  }
}

const code = computed(() => input.value.trim().toUpperCase());
const bars = computed(() => decorativeBars(code.value));
const last = computed(() => result.value?.signatures?.[result.value.signatures.length - 1]);
onMounted(() => { if (input.value) run(); });
</script>

<template>
  <!-- top-aligned, not vertically centred: a centred card jumps every time the result appears -->
  <div class="min-h-screen bg-surface-base px-3 pb-12 pt-8 sm:px-5 sm:pt-16">
    <div class="mx-auto w-full max-w-md space-y-6">
      <div class="space-y-4">
        <div class="inline-block rounded-4 bg-white px-2 py-1"><Brand :height="30" /></div>
        <div>
          <h1 class="text-2xl text-ink-gray-9">Verify a document</h1>
          <p class="mt-1 text-p-base text-ink-gray-5">Enter the reference code printed on the document, or scan its QR code.</p>
        </div>
      </div>

      <form class="space-y-3" @submit.prevent="run">
        <FormControl v-model="input" label="Reference code" placeholder="e.g. F14203A43D1D42C2…" autocomplete="off" autocapitalize="characters" spellcheck="false" required />
        <Button variant="solid" type="submit" class="w-full" size="md" :loading="loading">Check</Button>
      </form>

      <ErrorMessage :message="error" />

      <div v-if="result && !result.found" class="rounded-6 border border-outline-red-3 bg-surface-red-2 p-4 text-p-sm text-ink-red-7">
        <div class="text-base-medium">No such document</div>
        No record matches that reference code. It may be mistyped, or the document may not be genuine.
      </div>

      <!-- The receipt IS the result: it is what the database holds for this code. -->
      <div v-if="result?.found" class="space-y-4">
        <div v-if="!result.intact" class="space-y-1 rounded-6 border border-outline-amber-3 bg-surface-amber-2 p-4 text-p-sm text-ink-amber-7">
          <div class="text-base-medium">This request has changed since it was signed</div>
          A signed document is hashed against the request's data, and that data has changed since — so this printout no longer reflects what was approved. That is not proof of forgery: a request sent back for changes and resubmitted will also read this way. Ask the holder for a freshly generated copy, which carries a new reference code.
        </div>

        <div class="px-1">
          <div class="verify-paper bg-white px-5 pb-9 pt-5 font-mono text-[13px] text-[#16161a]">
            <div class="flex items-baseline justify-between gap-3">
              <span class="font-sans text-base font-semibold">{{ result.doc_type }}</span>
              <span class="text-[11px] text-[#737373]">issued {{ result.issued_at ? new Date(result.issued_at).toLocaleDateString() : '—' }}</span>
            </div>
            <div class="my-2 border-t border-dashed border-[#d4d4d4]" />
            <template v-if="result.signatures?.length">
              <div v-for="(s, i) in result.signatures" :key="i" class="py-1">
                <div class="flex justify-between gap-3"><span>{{ s.stage || s.role }}</span><span class="text-right">{{ s.signer }}</span></div>
                <div class="flex justify-between gap-3 text-[11px] text-[#737373]"><span>{{ s.role && s.role !== s.stage ? s.role : '' }}</span><span>{{ new Date(s.signed_at).toLocaleDateString() }}</span></div>
              </div>
            </template>
            <p v-else class="py-1 text-[#737373]">No approvals are recorded on this document.</p>
            <div class="my-2 border-t border-dashed border-[#d4d4d4]" />
            <svg class="block h-7 w-full" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
              <rect v-for="(w, i) in bars" :key="i" :x="bars.slice(0, i).reduce((a, b) => a + b + 1, 0)" y="0" :width="w" height="24" fill="currentColor" />
            </svg>
            <div class="mt-1 break-all text-center text-[11px] tracking-widest text-[#737373]">{{ code }}</div>
          </div>
        </div>

        <div v-if="last" class="flex justify-end pr-3 pt-1">
          <StampMark :role="last.stage || last.role || 'Approved'" :name="last.signer" :date="new Date(last.signed_at).toLocaleDateString()" :ink="result.intact ? '#1d4ed8' : '#b45309'" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* A torn-off strip: a zigzag of ~40 teeth along the bottom edge. */
.verify-paper {
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 7px), 97.5% 100%, 95% calc(100% - 7px), 92.5% 100%, 90% calc(100% - 7px), 87.5% 100%, 85% calc(100% - 7px), 82.5% 100%, 80% calc(100% - 7px), 77.5% 100%, 75% calc(100% - 7px), 72.5% 100%, 70% calc(100% - 7px), 67.5% 100%, 65% calc(100% - 7px), 62.5% 100%, 60% calc(100% - 7px), 57.5% 100%, 55% calc(100% - 7px), 52.5% 100%, 50% calc(100% - 7px), 47.5% 100%, 45% calc(100% - 7px), 42.5% 100%, 40% calc(100% - 7px), 37.5% 100%, 35% calc(100% - 7px), 32.5% 100%, 30% calc(100% - 7px), 27.5% 100%, 25% calc(100% - 7px), 22.5% 100%, 20% calc(100% - 7px), 17.5% 100%, 15% calc(100% - 7px), 12.5% 100%, 10% calc(100% - 7px), 7.5% 100%, 5% calc(100% - 7px), 2.5% 100%, 0 calc(100% - 7px));
  filter: drop-shadow(0 4px 8px rgb(0 0 0 / 0.12));
}
</style>
