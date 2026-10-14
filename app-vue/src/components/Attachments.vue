<script setup lang="ts">
import { ref, watch } from 'vue';
import { Button, ErrorMessage } from 'frappe-ui';
import MagneticDropzone from './MagneticDropzone.vue';
import { listAttachments, getAttachmentUrl, deleteAttachment, uploadAttachment, type Attachment } from '../lib/attachments';
import { errorMessage } from '../lib/requests';

// Same rules as the React Attachments: anyone who can see the request may
// upload (RLS is the gate); delete is uploader-only (0037) — the button is
// only offered to the uploader, RLS refuses anyone else regardless.
const props = defineProps<{ requestId: string; currentUserId: string }>();

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif';

const items = ref<Attachment[]>([]);
const error = ref('');
const busy = ref(false);
const confirming = ref<string | null>(null);

const load = () => listAttachments(props.requestId).then((a) => { items.value = a; }).catch(() => { items.value = []; });
watch(() => props.requestId, load, { immediate: true });

function size(b: number) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

async function open(a: Attachment) {
  try {
    const url = await getAttachmentUrl(a.object_key);
    if (url) window.open(url, '_blank', 'noopener');
  } catch (e) { error.value = errorMessage(e, 'Could not open that file.'); }
}

async function remove(a: Attachment) {
  busy.value = true; error.value = '';
  try { await deleteAttachment(a); confirming.value = null; await load(); }
  catch (e) { error.value = errorMessage(e, 'Could not delete that file.'); }
  finally { busy.value = false; }
}

const picked = ref<File | null>(null);

// Type and size are checked by the drop zone before anything is chosen; the
// storage bucket and database enforce the same limits regardless.
async function upload(file: File) {
  busy.value = true; error.value = '';
  try { await uploadAttachment(props.requestId, file); picked.value = null; await load(); }
  catch (err) { error.value = errorMessage(err, 'Could not upload that file.'); }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="space-y-2">
    <div class="text-sm text-ink-gray-5">Attachments</div>
    <ErrorMessage :message="error" />
    <div v-for="a in items" :key="a.id" class="flex gap-2">
      <Button class="min-w-0 flex-1" @click="open(a)">
        <div class="flex w-full min-w-0 items-center justify-between gap-3">
          <span class="truncate">{{ a.file_name }}</span>
          <span class="shrink-0 tabular-nums text-ink-gray-5">{{ size(a.size_bytes) }}</span>
        </div>
      </Button>
      <template v-if="a.uploaded_by === currentUserId">
        <Button v-if="confirming === a.id" theme="red" variant="solid" :loading="busy" @click="remove(a)">Confirm</Button>
        <Button v-else variant="ghost" :aria-label="`Delete ${a.file_name}`" @click="confirming = a.id">
          <span class="lucide-trash-2 size-4" aria-hidden="true" />
        </Button>
      </template>
    </div>
    <MagneticDropzone v-model:file="picked" :accept="ACCEPT.split(',')" :max-bytes="MAX_BYTES" :busy="busy" @upload="upload" />
  </div>
</template>
