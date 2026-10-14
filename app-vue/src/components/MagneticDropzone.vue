<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Button } from 'frappe-ui';

// A file drop zone that reacts to a drag before the file reaches it. The
// mechanism is dqnamo.com's "Magnetic Drop Zone" experiment: the window listens
// for drag events, and within ~180px of the card it leans up to ~10px toward the
// pointer (stronger the closer you get), scales slightly, and a soft glow tracks
// the pointer. A spring eases it in and settles it. Original implementation.
//
// States: idle → near ("Bring it closer") → over ("Let go to add it") → ready
// (file chosen: name, size, Replace / Remove) → error (wrong type or too big).
const props = withDefaults(defineProps<{
  accept?: string[];     // lowercase extensions, e.g. ['.pdf', '.png']
  maxBytes?: number;
  busy?: boolean;
}>(), { accept: () => [], maxBytes: 20 * 1024 * 1024, busy: false });
const file = defineModel<File | null>('file', { default: null });
const emit = defineEmits<{ upload: [file: File] }>();

const RANGE = 180;   // px from the card's edge where the pull begins
const PULL = 10;     // max px the card leans
const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const state = ref<'idle' | 'near' | 'over'>('idle');
const error = ref('');

// Spring: position chases a target with damping, so it eases in and settles
// without bouncing around. Reduced motion skips all of it.
const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pos = { x: 0, y: 0, s: 1, vx: 0, vy: 0, vs: 0, gx: 0, gy: 0 };
const target = { x: 0, y: 0, s: 1, gx: 0, gy: 0 };
const style = ref({ transform: 'none', '--gx': '50%', '--gy': '50%' } as Record<string, string>);
let raf = 0;

function tick() {
  const k = 0.16, d = 0.72; // stiffness, damping
  for (const a of ['x', 'y', 's'] as const) {
    const v = ('v' + a) as 'vx' | 'vy' | 'vs';
    pos[v] = (pos[v] + (target[a] - pos[a]) * k) * d;
    pos[a] += pos[v];
  }
  pos.gx += (target.gx - pos.gx) * 0.2; pos.gy += (target.gy - pos.gy) * 0.2;
  style.value = { transform: `translate(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px) scale(${pos.s.toFixed(4)})`, '--gx': `${pos.gx}%`, '--gy': `${pos.gy}%` };
  const settled = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y) + Math.abs(target.s - pos.s) < 0.01 && Math.abs(pos.vx) + Math.abs(pos.vy) + Math.abs(pos.vs) < 0.01;
  raf = settled ? 0 : requestAnimationFrame(tick);
}
const go = () => { if (!still && !raf) raf = requestAnimationFrame(tick); };

function rest() { state.value = 'idle'; Object.assign(target, { x: 0, y: 0, s: 1, gx: 50, gy: 50 }); go(); }

function onDrag(e: DragEvent) {
  if (!root.value || props.busy) return;
  if (!e.dataTransfer?.types.includes('Files')) return;
  const r = root.value.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  // distance from the pointer to the card's edge (0 when inside it)
  const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
  const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
  const dist = Math.hypot(dx, dy);
  if (dist > RANGE) { rest(); return; }
  const over = dist === 0;
  state.value = over ? 'over' : 'near';
  const strength = over ? 1 : 1 - dist / RANGE;
  const vx = e.clientX - cx, vy = e.clientY - cy, len = Math.hypot(vx, vy) || 1;
  Object.assign(target, {
    x: (vx / len) * PULL * strength, y: (vy / len) * PULL * strength,
    s: over ? 1.025 : 1 + 0.01 * strength,
    gx: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)),
    gy: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)),
  });
  go();
}
// dragover must be cancelled for a drop to be allowed at all
function allowDrop(e: DragEvent) { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); onDrag(e); }

function choose(f: File | undefined) {
  error.value = '';
  if (!f) return;
  const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
  if (props.accept.length && !props.accept.includes(ext)) { file.value = null; error.value = `That file type isn't allowed. Use ${props.accept.map((a) => a.slice(1).toUpperCase()).join(', ')}.`; return; }
  if (f.size > props.maxBytes) { file.value = null; error.value = `That file is too large — the limit is ${Math.round(props.maxBytes / 1048576)} MB.`; return; }
  file.value = f;
}
function onDrop(e: DragEvent) { e.preventDefault(); rest(); choose(e.dataTransfer?.files?.[0]); }
function onPick(e: Event) { const i = e.target as HTMLInputElement; choose(i.files?.[0]); i.value = ''; }

onMounted(() => {
  window.addEventListener('dragover', allowDrop);
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) rest(); });
  window.addEventListener('drop', onDropWindow);
  window.addEventListener('dragend', rest);
});
// A file dropped outside the card must not make the browser navigate to it.
function onDropWindow(e: DragEvent) { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); rest(); } }
onBeforeUnmount(() => {
  window.removeEventListener('dragover', allowDrop);
  window.removeEventListener('drop', onDropWindow);
  window.removeEventListener('dragend', rest);
  cancelAnimationFrame(raf);
});

const title = computed(() => state.value === 'over' ? 'Let go to add it' : state.value === 'near' ? 'Bring it closer' : 'Drop a file here');
const size = computed(() => !file.value ? '' : file.value.size < 1048576 ? `${Math.max(1, Math.round(file.value.size / 1024))} KB` : `${(file.value.size / 1048576).toFixed(1)} MB`);
const kind = computed(() => {
  const n = file.value?.name.toLowerCase() ?? '';
  return /\.(png|jpe?g|webp|gif)$/.test(n) ? 'lucide-image' : n.endsWith('.pdf') ? 'lucide-file-text' : 'lucide-file';
});
const hint = computed(() => `or click to browse · up to ${Math.round(props.maxBytes / 1048576)} MB`);
</script>

<template>
  <div class="space-y-2">
    <div
      ref="root"
      class="relative w-full max-w-sm select-none overflow-hidden rounded-6 border p-4 shadow-sm outline-none transition-colors duration-200 ease-out will-change-transform focus-within:ring-2 focus-within:ring-outline-blue-3"
      :class="state === 'over' ? 'border-outline-blue-3 bg-surface-blue-2' : state === 'near' ? 'border-outline-blue-2 bg-surface-blue-1' : 'border-outline-gray-2 bg-surface-gray-1'"
      :style="style"
      @dragover="allowDrop" @drop="onDrop"
    >
      <!-- soft glow that follows the pointer while a file is near -->
      <div class="pointer-events-none absolute inset-0 transition-opacity duration-200" :class="state === 'idle' ? 'opacity-0' : 'opacity-100'"
           style="background: radial-gradient(120px circle at var(--gx) var(--gy), color-mix(in srgb, var(--ink-blue-5, #2283c3) 28%, transparent), transparent 70%)" aria-hidden="true" />

      <div v-if="!file" class="relative flex cursor-pointer items-center gap-3" @click="input?.click()">
        <span class="flex size-12 flex-none items-center justify-center rounded-5 transition-colors duration-200" :class="state === 'idle' ? 'bg-surface-gray-3 text-ink-gray-6' : 'bg-surface-blue-3 text-ink-blue-5'">
          <span class="lucide-file-up size-5" aria-hidden="true" />
        </span>
        <div>
          <div class="text-base-medium text-ink-gray-9">{{ title }}</div>
          <div class="text-p-sm text-ink-gray-5">{{ hint }}</div>
        </div>
      </div>

      <div v-else class="relative flex items-center gap-3">
        <span class="flex size-12 flex-none items-center justify-center rounded-5 bg-surface-blue-7 text-white"><span :class="kind" class="size-5" aria-hidden="true" /></span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1 text-p-sm text-ink-green-7"><span class="lucide-check size-3.5" aria-hidden="true" /> Ready to upload</div>
          <div class="truncate text-base-medium text-ink-gray-9">{{ file.name }}</div>
          <div class="font-mono text-2xs uppercase tracking-wider text-ink-gray-5">{{ size }}</div>
        </div>
        <div class="flex flex-none flex-col gap-1">
          <Button size="sm" variant="solid" :loading="busy" @click="emit('upload', file!)">Upload</Button>
          <div class="flex gap-1">
            <Button size="sm" variant="ghost" :disabled="busy" @click="input?.click()">Replace</Button>
            <Button size="sm" variant="ghost" :disabled="busy" @click="file = null">Remove</Button>
          </div>
        </div>
      </div>

      <input ref="input" type="file" class="sr-only" :accept="accept.join(',')" @change="onPick" />
    </div>
    <p v-if="error" role="alert" class="text-p-sm text-ink-red-7">{{ error }}</p>
  </div>
</template>
