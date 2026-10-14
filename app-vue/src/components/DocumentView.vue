<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, ErrorMessage } from 'frappe-ui';
import {
  renderDocument, canPrint, verifyQrDataUrl, sanitizeDocumentHtml, type RenderedDocument,
} from '../lib/documents';
import { errorMessage } from '../lib/requests';

// Renders a generated document and hands it to the browser's print dialog —
// that is where the PDF comes from. No server-side renderer on purpose
// (PRD §14.4): the artefact is the generated_documents row (reference code +
// state hash), already minted by the database before anything is drawn.
const props = defineProps<{ requestId: string; docType: string }>();
const open = defineModel<boolean>('open', { required: true });

const doc = ref<RenderedDocument | null>(null);
const error = ref('');
const printable = ref(false);
const qrUrl = ref('');

watch(() => [props.requestId, props.docType], () => {
  doc.value = null; error.value = ''; qrUrl.value = '';
  renderDocument(props.requestId, props.docType)
    .then((d) => {
      doc.value = d;
      verifyQrDataUrl(d.reference_code).then((u) => { qrUrl.value = u; }).catch(() => { qrUrl.value = ''; });
    })
    .catch((e) => { error.value = errorMessage(e, 'Could not generate the document.'); });
  canPrint(props.requestId).then((p) => { printable.value = p; }).catch(() => { printable.value = false; });
}, { immediate: true });

const html = computed(() => (doc.value ? sanitizeDocumentHtml(doc.value.html) : ''));
const origin = window.location.origin;

const actions = computed(() => [
  { label: 'Close', variant: 'subtle' as const, onClick: ({ close }: { close: () => void }) => close() },
  {
    label: 'Print / Save as PDF', variant: 'solid' as const,
    disabled: !doc.value || !printable.value,
    onClick: () => window.print(),
  },
]);
</script>

<template>
  <Dialog v-model:open="open" :title="doc?.template_name ?? 'Document'" size="4xl" :actions="actions">
    <div class="space-y-3">
      <ErrorMessage :message="error" />
      <p v-if="!doc && !error" class="text-p-sm text-ink-gray-5">Generating…</p>
      <div v-if="doc" class="doc-sheet">
        <div v-html="html" />
        <div class="doc-footer">
          <div>
            Reference: <strong>{{ doc.reference_code }}</strong><br />
            Verify at {{ origin }}/verify
          </div>
          <img v-if="qrUrl" :src="qrUrl" alt="Scan to verify" class="doc-verify-qr" />
        </div>
      </div>
      <p v-if="doc && !printable" class="text-p-sm text-ink-amber-7">
        Printing is disabled: this request still has an unresolved approval or required task.
      </p>
      <p v-if="doc" class="text-p-sm text-ink-gray-5">
        This document can be regenerated identically at any time. Anyone can confirm it at /verify using the
        reference code — no account needed.
      </p>
    </div>
  </Dialog>

  <Teleport to="body">
    <div v-if="doc" id="doc-print-root">
      <div class="doc-sheet">
        <div v-html="html" />
        <div class="doc-footer">
          <div>
            Reference: <strong>{{ doc.reference_code }}</strong><br />
            Verify at {{ origin }}/verify
          </div>
          <img v-if="qrUrl" :src="qrUrl" alt="Scan to verify" class="doc-verify-qr" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
