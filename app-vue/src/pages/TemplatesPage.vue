<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { FormControl, Button, ErrorMessage } from 'frappe-ui';
import AppHeader from '../components/AppHeader.vue';
import { listCategories } from '../lib/org';
import { listLevels } from '../lib/levels';
import { listBindingKeys, listTemplates, saveTemplate, sanitizeDocumentHtml, type BindingKey, type DocumentTemplate } from '../lib/documents';
import type { RequestCategory, PriorityLevel } from '../lib/types';
import { errorMessage } from '../lib/requests';

// The captain's document template editor — PRD.md §14.3. Annexure 4.4 and the NOC
// are NOT shipped with the product: they are written here, per category. Saving
// always publishes a NEW version (a document already issued must regenerate
// identically — see the append-only note in schema-v2/0017).
const categories = ref<RequestCategory[]>([]);
const levels = ref<PriorityLevel[]>([]);
const categoryId = ref('');
const keys = ref<BindingKey[]>([]);
const templates = ref<DocumentTemplate[]>([]);
const docType = ref('');
const name = ref('');
const error = ref('');
const msg = ref('');
const busy = ref(false);
const previewing = ref(false);
const previewHtml = ref('');

const editor = ref<HTMLDivElement | null>(null);
let savedRange: Range | null = null;

onMounted(() => {
  Promise.all([listCategories(), listLevels()])
    .then(([c, l]) => { categories.value = c; levels.value = l; })
    .catch((e) => { error.value = errorMessage(e, 'Could not load categories.'); });
});

async function reload(id: string) {
  if (!id) { keys.value = []; templates.value = []; return; }
  try { [keys.value, templates.value] = await Promise.all([listBindingKeys(id), listTemplates(id)]); }
  catch (e) { error.value = errorMessage(e, 'Could not load templates.'); }
}
watch(categoryId, reload);

// contenteditable loses the caret the moment a toolbar control takes focus, so the
// selection is captured on the way out and restored before inserting.
function rememberCaret() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.value?.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
}
function restoreCaret() {
  const sel = window.getSelection();
  if (savedRange && sel) { sel.removeAllRanges(); sel.addRange(savedRange); }
}
function insertAtCaret(text: string) {
  const el = editor.value; if (!el) return;
  el.focus(); restoreCaret();
  const sel = window.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (!range) { el.append(text); return; }
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node); range.collapse(true);
  sel?.removeAllRanges(); sel?.addRange(range);
  savedRange = range.cloneRange();
}
// execCommand is deprecated but is still the only thing every browser implements for
// contenteditable formatting; the alternative is a rich-text engine for four buttons.
function format(command: string, value?: string) {
  editor.value?.focus(); restoreCaret();
  document.execCommand(command, false, value);
}

const builtIns = computed(() => keys.value.filter((k) => k.source === 'built-in'));
const fields = computed(() => keys.value.filter((k) => k.source === 'field'));
const fieldOptions = computed(() => [
  ...builtIns.value.map((k) => ({ label: `Request · ${k.label}`, value: `{{${k.key}}}` })),
  ...fields.value.map((k) => ({ label: `Field · ${k.label}`, value: `{{${k.key}}}` })),
]);
const signatureOptions = computed(() => levels.value.map((l) => ({ label: `${l.name}'s signature`, value: `{{signature:${l.id}}}` })));

// Signature slots store the level's id, not its name — renaming a level must not
// silently unmatch templates. The id is unreadable, so the preview shows the name.
const readableSlots = (html: string) =>
  levels.value.reduce((acc, l) => acc.replaceAll(`{{signature:${l.id}}}`, `⟨${l.name}'s signature⟩`), html);

async function togglePreview() {
  if (!previewing.value) previewHtml.value = readableSlots(sanitizeDocumentHtml(editor.value?.innerHTML ?? ''));
  const html = editor.value?.innerHTML ?? '';
  previewing.value = !previewing.value;
  // The editor is v-show'd rather than v-if'd so its content survives the round trip.
  await nextTick();
  if (!previewing.value && editor.value) editor.value.innerHTML = html;
}

async function save() {
  error.value = ''; msg.value = '';
  const html = sanitizeDocumentHtml(editor.value?.innerHTML ?? '');
  if (!categoryId.value) { error.value = 'Choose a category first.'; return; }
  if (!docType.value.trim()) { error.value = 'Give the document a type, e.g. annexure_4_4.'; return; }
  if (!editor.value?.textContent?.trim()) { error.value = 'The template is empty.'; return; }
  busy.value = true;
  try {
    await saveTemplate(categoryId.value, docType.value.trim(), name.value.trim() || docType.value.trim(), html);
    await reload(categoryId.value);
    msg.value = 'Published. Documents generated from now on use this version; ones already issued keep theirs.';
  } catch (e) { error.value = errorMessage(e, 'Could not save the template.'); }
  finally { busy.value = false; }
}

function loadVersion(t: DocumentTemplate) {
  docType.value = t.doc_type; name.value = t.name;
  if (editor.value) editor.value.innerHTML = sanitizeDocumentHtml(t.body_html);
  msg.value = `Loaded ${t.doc_type} v${t.version}. Saving publishes a new version.`;
}

const categoryOptions = computed(() => categories.value.map((c) => ({ label: c.name, value: c.id })));
</script>

<template>
  <AppHeader title="Document templates" />
  <div class="max-w-4xl space-y-5 px-3 pb-10 pt-5 sm:px-5">
    <p class="text-p-sm text-ink-gray-5">Letters generated from a request — an Annexure, an NOC. Written here, per category, with the request's own fields dropped in.</p>
    <ErrorMessage :message="error" />
    <p v-if="msg" class="text-p-sm text-ink-green-7">{{ msg }}</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <FormControl v-model="categoryId" type="select" label="Category" :options="categoryOptions" />
      <FormControl v-model="docType" label="Document type" placeholder="annexure_4_4" />
      <FormControl v-model="name" label="Display name" placeholder="Annexure 4.4" />
    </div>

    <section v-if="categoryId" class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg-semibold">Template</h2>
        <Button size="sm" @click="togglePreview">{{ previewing ? 'Edit' : 'Preview' }}</Button>
      </div>

      <div v-show="!previewing" class="flex flex-wrap items-center gap-2" @mousedown="rememberCaret">
        <Button size="sm" @mousedown.prevent @click="format('bold')"><span class="lucide-bold size-4" aria-label="Bold" /></Button>
        <Button size="sm" @mousedown.prevent @click="format('italic')"><span class="lucide-italic size-4" aria-label="Italic" /></Button>
        <Button size="sm" @mousedown.prevent @click="format('formatBlock', 'h2')"><span class="lucide-heading size-4" aria-label="Heading" /></Button>
        <Button size="sm" @mousedown.prevent @click="format('insertUnorderedList')"><span class="lucide-list size-4" aria-label="List" /></Button>
        <div class="w-52" @mousedown="rememberCaret"><FormControl :model-value="''" type="select" placeholder="Insert field…" :options="fieldOptions" @update:model-value="$event && insertAtCaret(String($event))" /></div>
        <div class="w-52" @mousedown="rememberCaret"><FormControl :model-value="''" type="select" placeholder="Insert signature…" :options="signatureOptions" @update:model-value="$event && insertAtCaret(String($event))" /></div>
      </div>

      <div
        v-show="!previewing" ref="editor" contenteditable="true"
        class="doc-sheet min-h-64 outline-none"
        @keyup="rememberCaret" @mouseup="rememberCaret" @blur="rememberCaret"
      />
      <div v-if="previewing" class="doc-sheet min-h-64" v-html="previewHtml" />

      <p class="text-p-sm text-ink-gray-5">A field that has no value on a request prints as a dash, so a gap is visible rather than silent. A signature slot with nobody signed prints “Not yet signed”.</p>
      <Button variant="solid" :loading="busy" @click="save">Publish version</Button>
    </section>

    <section v-if="templates.length" class="space-y-2">
      <h2 class="text-lg-semibold">Published versions</h2>
      <div class="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <table class="w-full text-left text-p-sm">
        <thead class="border-b text-ink-gray-5"><tr><th class="py-2 font-normal">Type</th><th class="font-normal">Name</th><th class="font-normal">Version</th><th class="font-normal">Published</th><th /></tr></thead>
        <tbody class="divide-y divide-outline-gray-1">
          <tr v-for="t in templates" :key="t.id">
            <td class="py-2 font-mono">{{ t.doc_type }}</td><td>{{ t.name }}</td><td>v{{ t.version }}</td>
            <td class="tabular-nums">{{ new Date(t.created_at).toLocaleDateString() }}</td>
            <td class="text-right"><Button size="sm" @click="loadVersion(t)">New version from this</Button></td>
          </tr>
        </tbody>
      </table>
</div>
    </section>
  </div>
</template>
