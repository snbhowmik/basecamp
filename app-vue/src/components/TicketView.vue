<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, ErrorMessage } from 'frappe-ui';
import { renderDocument, verifyQrDataUrl } from '../lib/documents';
import { errorMessage, type RequestRow } from '../lib/requests';

// A friendlier confirmation view for an approved request — two-part card with
// a perforated tear line. Additional to, not a replacement for, the official
// printable document. The QR is the same verify code the document carries.
const props = defineProps<{ requestId: string; docType: string; request: RequestRow }>();
const open = defineModel<boolean>('open', { required: true });

const referenceCode = ref('');
const qrUrl = ref('');
const error = ref('');

watch(() => [props.requestId, props.docType], () => {
  error.value = '';
  renderDocument(props.requestId, props.docType)
    .then((d) => { referenceCode.value = d.reference_code; return verifyQrDataUrl(d.reference_code); })
    .then((u) => { qrUrl.value = u; })
    .catch((e) => { error.value = errorMessage(e, 'Could not generate the ticket.'); });
}, { immediate: true });

const date = computed(() => new Date(props.request.submitted_at ?? props.request.created_at).toLocaleDateString());
</script>

<template>
  <Dialog v-model:open="open" size="sm" bare>
    <ErrorMessage :message="error" />
    <div v-if="!error" class="overflow-hidden rounded-6 bg-surface-blue-7 text-white shadow-xl">
      <div class="p-5 pb-4">
        <div class="text-xs font-semibold uppercase tracking-wider opacity-75">{{ request.request_categories?.name ?? 'Request' }}</div>
        <div class="mt-1 text-xl-semibold">{{ request.title }}</div>
        <div v-if="request.requester?.full_name" class="mt-3">
          <div class="text-2xs font-semibold uppercase tracking-wider opacity-70">Requested by</div>
          <div class="text-sm font-semibold">{{ request.requester.full_name }}</div>
        </div>
        <div class="mt-3 flex gap-6">
          <div><div class="text-2xs font-semibold uppercase tracking-wider opacity-70">Date</div><div class="text-sm font-semibold">{{ date }}</div></div>
          <div><div class="text-2xs font-semibold uppercase tracking-wider opacity-70">Status</div><div class="text-sm font-semibold">Approved</div></div>
        </div>
      </div>
      <div class="relative border-t-2 border-dashed border-white/40" aria-hidden="true">
        <span class="absolute -left-2.5 -top-2.5 size-5 rounded-full bg-surface-base" />
        <span class="absolute -right-2.5 -top-2.5 size-5 rounded-full bg-surface-base" />
      </div>
      <div class="flex items-center justify-between gap-4 bg-black/10 p-5">
        <div class="min-w-0 flex-1 space-y-2">
          <div><div class="text-2xs font-semibold uppercase tracking-wider opacity-70">Admit</div><div class="text-sm font-semibold">One</div></div>
          <div>
            <div class="text-2xs font-semibold uppercase tracking-wider opacity-70">Reference</div>
            <div class="break-all font-mono text-sm font-semibold">{{ referenceCode || '…' }}</div>
          </div>
        </div>
        <img v-if="qrUrl" :src="qrUrl" alt="Scan to verify" class="size-14 flex-none rounded bg-white p-0.5" />
      </div>
    </div>
  </Dialog>
</template>
