<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button, ErrorMessage } from 'frappe-ui';
import { getMySignatureUrl, uploadSignature } from '../lib/documents';
import { errorMessage } from '../lib/requests';

// PRD.md §14.1 — register a signature once, reuse it on every document. The
// cleaning pass (background removal, tight crop) runs in a canvas here, not in
// a service: it is a pure pixel transform, needs no secret, and keeps the photo
// of a signature off the server — only the cleaned stamp is uploaded.
const CANVAS_W = 600;
const CANVAS_H = 200;
// Pixels lighter than this are paper. Deliberately high: a phone photo of a
// signature is rarely pure white, and erring towards removal leaves a cleaner
// stamp than a grey wash behind the ink.
const PAPER_LUMINANCE = 180;
// Every stamp leaves at exactly this size, so a document shows one signature box.
// The mark is fitted (not cropped, not stretched) so a wide signature keeps its tail.
const STAMP_W = 275;
const STAMP_H = 118;

function cleanToStamp(source: HTMLCanvasElement): Promise<Blob | null> {
  const ctx = source.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  const img = ctx.getImageData(0, 0, source.width, source.height);
  const d = img.data;
  let minX = source.width, minY = source.height, maxX = -1, maxY = -1;

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (d[i + 3] < 16 || lum > PAPER_LUMINANCE) { d[i + 3] = 0; continue; }
      // Normalise the ink to one dark stroke; softer ink stays softer, keeping stroke edges.
      d[i] = 17; d[i + 1] = 24; d[i + 2] = 39;
      d[i + 3] = Math.min(255, Math.round((PAPER_LUMINANCE - lum) / PAPER_LUMINANCE * 255) + 60);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return Promise.resolve(null);
  ctx.putImageData(img, 0, 0);

  const pad = 6;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const w = Math.min(source.width - sx, maxX - minX + 1 + pad * 2);
  const h = Math.min(source.height - sy, maxY - minY + 1 + pad * 2);
  // Never scale up past 1: enlarging a small scribble only magnifies camera noise.
  const scale = Math.min(STAMP_W / w, STAMP_H / h, 1);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);

  const out = document.createElement('canvas');
  out.width = STAMP_W; out.height = STAMP_H;
  out.getContext('2d')?.drawImage(source, sx, sy, w, h, Math.round((STAMP_W - dw) / 2), Math.round((STAMP_H - dh) / 2), dw, dh);
  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
}

const canvas = ref<HTMLCanvasElement | null>(null);
let drawing = false;
let dirty = false;

const current = ref<string | null>(null);
const preview = ref<string | null>(null);
const pending = ref<Blob | null>(null);
const error = ref('');
const msg = ref('');
const busy = ref(false);

onMounted(() => {
  getMySignatureUrl().then((u) => { current.value = u; }).catch((e) => { error.value = errorMessage(e, 'Could not load your signature.'); });
});

const c2d = () => canvas.value?.getContext('2d') ?? null;

// Pointer events: one code path for a stylus, a finger and a mouse.
function pos(e: PointerEvent) {
  const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
  return { x: (e.clientX - r.left) * (CANVAS_W / r.width), y: (e.clientY - r.top) * (CANVAS_H / r.height) };
}
function start(e: PointerEvent) {
  (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
  const c = c2d(); if (!c) return;
  const { x, y } = pos(e);
  c.beginPath(); c.moveTo(x, y);
  drawing = true;
}
function move(e: PointerEvent) {
  if (!drawing) return;
  const c = c2d(); if (!c) return;
  const { x, y } = pos(e);
  c.lineWidth = 2.5; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#111827';
  c.lineTo(x, y); c.stroke();
  dirty = true;
}
const end = () => { drawing = false; };

function clearPad() {
  c2d()?.clearRect(0, 0, CANVAS_W, CANVAS_H);
  dirty = false; pending.value = null; preview.value = null; msg.value = '';
}

async function useDrawing() {
  error.value = ''; msg.value = '';
  if (!canvas.value || !dirty) { error.value = 'Draw your signature first.'; return; }
  // Clean a COPY: the pixel pass is destructive and previewing must not wipe the pad.
  const copy = document.createElement('canvas');
  copy.width = CANVAS_W; copy.height = CANVAS_H;
  copy.getContext('2d')?.drawImage(canvas.value, 0, 0);
  const blob = await cleanToStamp(copy);
  if (!blob) { error.value = 'Nothing to save — the pad looks empty.'; return; }
  pending.value = blob; preview.value = URL.createObjectURL(blob);
}

async function useFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // so re-picking the same file fires change again
  if (!file) return;
  error.value = ''; msg.value = '';
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = url;
    });
    // Cap the working size: a 12-megapixel photo would make the pixel pass crawl for no gain.
    const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    const blob = await cleanToStamp(c);
    if (!blob) { error.value = 'No signature found in that image — try a clearer photo.'; return; }
    pending.value = blob; preview.value = URL.createObjectURL(blob);
  } catch (err) { error.value = errorMessage(err, 'Could not read that image.'); }
  finally { URL.revokeObjectURL(url); }
}

async function save() {
  if (!pending.value) return;
  error.value = ''; msg.value = ''; busy.value = true;
  try {
    await uploadSignature(pending.value);
    current.value = await getMySignatureUrl();
    clearPad();
    msg.value = 'Signature saved. It will be stamped on documents you approve from now on.';
  } catch (e) { error.value = errorMessage(e, 'Could not save your signature.'); }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="space-y-3">
    <h2 class="text-lg-semibold">Signature</h2>
    <p class="text-p-sm text-ink-gray-5">Registered once and reused on every document you approve. Draw it below, or upload a photo of your signature on white paper — the background is removed automatically.</p>
    <ErrorMessage :message="error" />
    <p v-if="msg" class="text-p-sm text-ink-green-7">{{ msg }}</p>

    <div v-if="current && !preview" class="space-y-1">
      <div class="text-sm text-ink-gray-5">Current signature</div>
      <div class="inline-block rounded-5 border bg-white p-3"><img :src="current" alt="Your registered signature" class="max-h-24" /></div>
    </div>

    <div class="space-y-1">
      <div class="text-sm text-ink-gray-5">{{ current ? 'Replace it' : 'Draw your signature' }}</div>
      <canvas
        ref="canvas" :width="CANVAS_W" :height="CANVAS_H"
        class="block w-full max-w-[600px] cursor-crosshair rounded-5 border border-dashed bg-white"
        style="touch-action: none; aspect-ratio: 600 / 200"
        @pointerdown="start" @pointermove="move" @pointerup="end" @pointerleave="end"
      />
    </div>

    <div class="flex flex-wrap gap-2">
      <Button @click="clearPad">Clear</Button>
      <Button @click="useDrawing">Use drawing</Button>
      <label class="inline-flex">
        <input type="file" accept="image/*" class="hidden" @change="useFile" />
        <span class="inline-flex h-7 cursor-pointer items-center rounded-4 bg-surface-gray-2 px-2 text-base text-ink-gray-8 hover:bg-surface-gray-3">Upload photo</span>
      </label>
    </div>

    <div v-if="preview" class="space-y-2">
      <div class="text-sm text-ink-gray-5">Cleaned stamp — this is what will appear on documents</div>
      <div class="inline-block rounded-5 border bg-white p-3"><img :src="preview" alt="Cleaned signature preview" class="max-h-24" /></div>
      <div><Button variant="solid" :loading="busy" @click="save">Save signature</Button></div>
    </div>
  </section>
</template>
