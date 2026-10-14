<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, ErrorMessage } from 'frappe-ui';
import { renderDocument, verifyQrDataUrl } from '../lib/documents';
import { errorMessage, type RequestRow } from '../lib/requests';

// A ticket-styled view of an approved request. The mechanism is dqnamo.com's
// "Ticket" experiment: a tall card in two regions (body and a fixed-height stub)
// split by a dashed tear line, with real notches cut into both sides where they
// meet and chamfered corners, a soft sheen across one corner, layered shadows,
// and a hover tilt (up to 6° each axis, slight scale) on devices that can hover.
// An original implementation. It is additional to — not a replacement for — the
// official printable document; the QR is the same verify code that carries.
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

// Tilt follows the pointer; skipped for reduced motion and for pointers that cannot hover.
const canTilt = typeof window !== 'undefined'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const tilt = ref('');
function onMove(e: PointerEvent) {
  if (!canTilt) return;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width - 0.5;
  const py = (e.clientY - r.top) / r.height - 0.5;
  tilt.value = `perspective(900px) rotateX(${(-py * 12).toFixed(2)}deg) rotateY(${(px * 12).toFixed(2)}deg) scale(1.018)`;
}
const onLeave = () => { tilt.value = ''; };
</script>

<template>
  <Dialog v-model:open="open" size="sm" bare>
    <ErrorMessage :message="error" />
    <div v-if="!error" class="flex justify-center p-2">
      <div class="ticket-shadow" :style="{ transform: tilt || undefined }" @pointermove="onMove" @pointerleave="onLeave">
        <div class="ticket" role="group" :aria-label="`Ticket for ${request.title}`">
          <div class="ticket-body">
            <div class="text-2xs font-semibold uppercase tracking-widest opacity-75">{{ request.request_categories?.name ?? 'Request' }}</div>
            <div class="mt-1 text-xl-semibold leading-tight">{{ request.title }}</div>
            <p v-if="request.body" class="mt-2 line-clamp-3 text-p-sm opacity-85">{{ request.body }}</p>
            <div class="mt-auto space-y-3">
              <div v-if="request.requester?.full_name">
                <div class="text-2xs font-semibold uppercase tracking-widest opacity-70">Requested by</div>
                <div class="text-sm font-semibold">{{ request.requester.full_name }}</div>
              </div>
              <div class="flex gap-6">
                <div><div class="text-2xs font-semibold uppercase tracking-widest opacity-70">Date</div><div class="text-sm font-semibold">{{ date }}</div></div>
                <div><div class="text-2xs font-semibold uppercase tracking-widest opacity-70">Status</div><div class="text-sm font-semibold">Approved</div></div>
              </div>
            </div>
          </div>
          <div class="ticket-tear" aria-hidden="true" />
          <div class="ticket-stub">
            <div class="min-w-0 flex-1 space-y-2">
              <div><div class="text-2xs font-semibold uppercase tracking-widest opacity-70">Admit</div><div class="text-sm font-semibold">One</div></div>
              <div>
                <div class="text-2xs font-semibold uppercase tracking-widest opacity-70">Reference</div>
                <div class="break-all font-mono text-xs font-semibold">{{ referenceCode || '…' }}</div>
              </div>
            </div>
            <img v-if="qrUrl" :src="qrUrl" alt="Scan to verify" class="size-16 flex-none rounded bg-white p-0.5" />
          </div>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
/* Layered shadows go on a wrapper: clip-path on the card would cut its own box-shadow off. */
.ticket-shadow {
  width: 17rem;
  filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.18)) drop-shadow(0 14px 22px rgb(0 0 0 / 0.22));
  transition: transform 220ms ease-out;
  will-change: transform;
}
.ticket {
  --stub: 8.5rem;       /* the stub's fixed height; the notches sit on its top edge */
  --notch: 11px;
  --cut: 16px;          /* the chamfer */
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 25rem;
  color: #fff;
  background: var(--surface-blue-7, #2563eb);
  /* a soft white sheen across the top-left corner, like light on paper */
  background-image: linear-gradient(135deg, rgb(255 255 255 / 0.22), rgb(255 255 255 / 0) 42%);
  /* chamfered corners */
  clip-path: polygon(var(--cut) 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% calc(100% - var(--cut)),
    calc(100% - var(--cut)) 100%, var(--cut) 100%, 0 calc(100% - var(--cut)), 0 var(--cut));
  /* real notches on both sides where body meets stub — transparent, so it works on any background */
  -webkit-mask:
    radial-gradient(circle var(--notch) at 0 calc(100% - var(--stub)), #0000 98%, #000),
    radial-gradient(circle var(--notch) at 100% calc(100% - var(--stub)), #0000 98%, #000);
  -webkit-mask-composite: source-in;
  mask:
    radial-gradient(circle var(--notch) at 0 calc(100% - var(--stub)), #0000 98%, #000),
    radial-gradient(circle var(--notch) at 100% calc(100% - var(--stub)), #0000 98%, #000);
  mask-composite: intersect;
}
.ticket-body { display: flex; flex: 1; flex-direction: column; gap: 0.25rem; padding: 1.4rem 1.25rem 1rem; }
.ticket-tear { height: 0; margin: 0 calc(var(--notch) + 4px); border-top: 2px dashed rgb(255 255 255 / 0.4); }
.ticket-stub { display: flex; align-items: center; gap: 1rem; height: var(--stub); padding: 0 1.25rem; box-sizing: border-box; }
@media (prefers-reduced-motion: reduce) { .ticket-shadow { transition: none; } }
</style>
