<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Button, FormControl, ErrorMessage } from 'frappe-ui';
import { supabase } from '../lib/supabase';

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

onMounted(() => { if (input.value) run(); });
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-base p-5">
    <div class="w-full max-w-md space-y-4">
      <div>
        <h1 class="text-2xl text-ink-gray-9">Verify a document</h1>
        <p class="text-p-base text-ink-gray-5">Enter the reference code printed on the document.</p>
      </div>
      <form class="space-y-3" @submit.prevent="run">
        <FormControl v-model="input" label="Reference code" required />
        <Button variant="solid" type="submit" class="w-full" :loading="loading">Check</Button>
      </form>
      <ErrorMessage :message="error" />
      <div v-if="result && !result.found" class="rounded-6 border border-outline-red-3 bg-surface-red-2 p-4 text-ink-red-7 text-p-sm">
        No record matches that reference code.
      </div>
      <div v-if="result?.found" class="space-y-3 rounded-6 border p-4" :class="result.intact ? 'border-outline-green-3 bg-surface-green-2 text-ink-green-7' : 'border-outline-amber-3 bg-surface-amber-2 text-ink-amber-7'">
        <div class="text-base-medium">{{ result.intact ? 'Genuine — and unchanged since it was signed.' : 'Genuine record, but the request has changed since it was signed.' }}</div>
        <div class="text-p-sm">{{ result.doc_type }} · issued {{ result.issued_at ? new Date(result.issued_at).toLocaleDateString() : '—' }}</div>
        <ul v-if="result.signatures?.length" class="divide-y divide-outline-gray-1 text-p-sm">
          <li v-for="(s, i) in result.signatures" :key="i" class="flex justify-between py-1.5">
            <span>{{ s.stage || s.role }}</span>
            <span>{{ s.signer }} · {{ new Date(s.signed_at).toLocaleDateString() }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
