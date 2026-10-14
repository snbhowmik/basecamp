<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Button } from 'frappe-ui';
import { decorativeBars } from '../lib/barcode';
import type { RequestRow } from '../lib/requests';

// A thermal receipt printer for the moment a request is submitted. The mechanism
// is dqnamo.com's "Receipt Printer" experiment (a dark housing with a status
// screen; paper that feeds out of a slot in small steps; a torn zigzag edge) —
// an original implementation, not their source.
//
// It tells the truth about progress: it stays on "Processing" until the request
// has really been created (`request` is null until then), only then prints, and
// prints the real reference number, category, title and time.
const props = defineProps<{ request: RequestRow | null }>();
const emit = defineEmits<{ done: [] }>();

const STEPS = 20;
const step = ref(0);
const stage = computed<'processing' | 'printing' | 'complete'>(() =>
  !props.request ? 'processing' : step.value < STEPS ? 'printing' : 'complete');

let timer: ReturnType<typeof setInterval> | undefined;
watch(() => props.request, (r) => {
  clearInterval(timer);
  step.value = 0;
  if (!r) return;
  // Reduced motion: no feeding animation, just the finished receipt.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { step.value = STEPS; return; }
  // "Stepped" feed: a line at a time with small pauses, like a real printer.
  timer = setInterval(() => { step.value += 1; if (step.value >= STEPS) clearInterval(timer); }, 95);
}, { immediate: true });
onBeforeUnmount(() => clearInterval(timer));

const bars = computed(() => decorativeBars(props.request?.reference_number ?? ''));
const when = computed(() => props.request ? new Date(props.request.submitted_at ?? props.request.created_at).toLocaleString() : '');
// A zigzag of ~40 teeth along the bottom edge: the paper reads as torn off.
const teeth = 40;
const zigzag = (() => {
  const pts = ['0 0', '100% 0'];
  for (let i = teeth; i >= 0; i--) pts.push(`${(i / teeth) * 100}% ${i % 2 === 0 ? 'calc(100% - 7px)' : '100%'}`);
  return `polygon(${pts.join(', ')})`;
})();
const label = computed(() => ({ processing: 'Processing your request', printing: 'Printing your receipt', complete: 'Request submitted' }[stage.value]));
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Request submitted">
      <div class="w-[22rem] max-w-full">
        <!-- the printer -->
        <div class="relative z-10 rounded-7 bg-[#171717] px-5 pb-5 pt-4 text-white shadow-2xl">
          <div class="text-sm text-white/60">{{ request?.request_categories?.name ?? 'New request' }}</div>
          <div class="truncate text-lg-semibold">{{ request?.title ?? 'Sending to your approver' }}</div>
          <div class="mt-3 flex items-center gap-2 border-t border-white/15 pt-3 text-sm text-white/85" aria-live="polite">
            <span v-if="stage !== 'complete'" class="size-4 animate-spin rounded-full border-2 border-white/25 border-t-white" aria-hidden="true" />
            <span v-else class="lucide-circle-check size-4 text-green-400" aria-hidden="true" />
            <Transition mode="out-in" enter-active-class="transition duration-150" enter-from-class="opacity-0 scale-95" leave-active-class="transition duration-150" leave-to-class="opacity-0 scale-95">
              <span :key="label">{{ label }}</span>
            </Transition>
          </div>
          <!-- the slot the paper leaves through -->
          <div class="absolute inset-x-4 -bottom-1 h-2 rounded-full bg-black/80" aria-hidden="true" />
        </div>

        <!-- paper: clipped to the area under the slot, then fed down in steps -->
        <div class="relative mx-3 -mt-1 overflow-hidden" :style="{ height: request ? '22rem' : '0' }">
          <div class="absolute inset-x-0 top-0 z-10 h-3 bg-gradient-to-b from-black/30 to-transparent" aria-hidden="true" />
          <div
            class="bg-white px-4 pb-8 pt-5 font-mono text-[13px] text-[#16161a] shadow-lg"
            :style="{ clipPath: zigzag, transform: `translateY(${-(1 - step / STEPS) * 100}%)` }"
          >
            <div v-if="request" class="space-y-1.5">
              <div class="flex justify-between gap-3 font-sans text-base font-semibold"><span>{{ request.request_categories?.name ?? 'Request' }}</span></div>
              <div class="flex justify-between gap-3"><span class="text-[#737373]">Subject</span><span class="text-right">{{ request.title }}</span></div>
              <div v-if="request.requester?.full_name" class="flex justify-between gap-3"><span class="text-[#737373]">Raised by</span><span class="text-right">{{ request.requester.full_name }}</span></div>
              <div class="my-2 border-t border-dashed border-[#d4d4d4]" />
              <div class="flex justify-between gap-3"><span class="text-[#737373]">Reference</span><span>{{ request.reference_number }}</span></div>
              <div class="flex justify-between gap-3"><span class="text-[#737373]">Submitted</span><span>{{ when }}</span></div>
              <svg class="mt-3 block h-7 w-full text-[#16161a]" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
                <rect v-for="(w, i) in bars" :key="i" :x="bars.slice(0, i).reduce((a, b) => a + b + 1, 0)" y="0" :width="w" height="24" fill="currentColor" />
              </svg>
              <div class="text-center text-[11px] tracking-widest text-[#737373]">{{ request.reference_number }}</div>
            </div>
          </div>
        </div>

        <div class="mt-4 flex justify-center">
          <Button v-if="stage === 'complete'" variant="solid" @click="emit('done')">Done</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
