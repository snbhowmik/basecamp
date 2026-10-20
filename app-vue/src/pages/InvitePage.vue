<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { FormControl, Button, ErrorMessage, Badge, TabButtons } from 'frappe-ui';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDestructive from '../components/ConfirmDestructive.vue';
import { supabase } from '../lib/supabase';
import {
  listPriorityLevels, listTags, listOrgUnits, listBatches, listSections, listMyInvites,
  createInvite, revokeInvite, resendInviteEmail, inviteLink,
} from '../lib/invites';
import type { PriorityLevel, Tag, OrgUnit, Batch, Section, MemberType, RoleKind, PendingAssignment } from '../lib/types';
import { errorMessage } from '../lib/requests';

// Who can invite whom is enforced server-side by can_invite() (rank + org-unit
// scoping). The level list is filtered by my_best_rank() for UX only.
const levels = ref<PriorityLevel[]>([]);
const tags = ref<Tag[]>([]);
const orgUnits = ref<OrgUnit[]>([]);
const batches = ref<Batch[]>([]);
const sections = ref<Section[]>([]);
const invites = ref<PendingAssignment[]>([]);
const myRank = ref<number | null>(null);
const loading = ref(true);
const error = ref('');
const success = ref('');
const submitting = ref(false);
const resending = ref<string | null>(null);

const email = ref('');
const levelId = ref('');
const selectedTags = ref<string[]>([]);
const memberType = ref<MemberType>('student');
const roleKind = ref<RoleKind>('academic');
const orgUnitId = ref('');
const batchId = ref('');
const sectionId = ref('');
const regNo = ref('');
const fetId = ref('');
const lastLink = ref<string | null>(null);
const copied = ref(false);

const mode = ref<'single' | 'bulk'>('single');
const bulkText = ref('');
const bulkBusy = ref(false);
const bulkResults = ref<{ email: string; regNo: string; status: 'pending' | 'ok' | 'error'; message?: string }[]>([]);

const revoking = ref<PendingAssignment | null>(null);
const showRevoke = ref(false);

async function load() {
  try {
    const [lv, tg, dp, inv, rank] = await Promise.all([
      listPriorityLevels(), listTags(), listOrgUnits(), listMyInvites(), supabase.rpc('my_best_rank'),
    ]);
    levels.value = lv;
    tags.value = tg.filter((t) => t.code !== 'admin');
    orgUnits.value = dp;
    invites.value = inv;
    myRank.value = typeof rank.data === 'number' ? rank.data : null;
  } catch (e) { error.value = errorMessage(e, 'Failed to load.'); }
  finally { loading.value = false; }
}
onMounted(load);

watch(orgUnitId, (id) => {
  batches.value = []; batchId.value = '';
  if (id) listBatches(id).then((b) => { batches.value = b; }).catch(() => { batches.value = []; });
});
watch(batchId, (id) => {
  sections.value = []; sectionId.value = '';
  if (id) listSections(id).then((s) => { sections.value = s; }).catch(() => { sections.value = []; });
});

// A lower rank number is higher authority: invitable levels are strictly lower.
const invitable = computed(() => myRank.value === null ? levels.value : levels.value.filter((l) => l.rank > myRank.value!));
const levelOptions = computed(() => invitable.value.map((l) => ({ label: l.name, value: l.id })));
const unitOptions = computed(() => [{ label: 'No org scoping', value: '' }, ...orgUnits.value.map((o) => ({ label: o.name, value: o.id }))]);
const batchOptions = computed(() => [{ label: 'No batch scoping', value: '' }, ...batches.value.map((b) => ({ label: b.name, value: b.id }))]);
const sectionOptions = computed(() => [{ label: 'No section scoping', value: '' }, ...sections.value.map((s) => ({ label: s.name, value: s.id }))]);
const typeOptions = [{ label: 'Student', value: 'student' }, { label: 'Staff', value: 'staff' }];
const kindOptions = ['academic', 'club', 'event', 'admin'].map((k) => ({ label: k, value: k }));

const toggleTag = (code: string) => {
  selectedTags.value = selectedTags.value.includes(code)
    ? selectedTags.value.filter((c) => c !== code) : [...selectedTags.value, code];
};

function resetForm() {
  email.value = ''; levelId.value = ''; selectedTags.value = []; memberType.value = 'student'; roleKind.value = 'academic';
  orgUnitId.value = ''; batchId.value = ''; sectionId.value = ''; regNo.value = ''; fetId.value = '';
}

function deliveryLabel(inv: PendingAssignment): string {
  if (inv.invite_email_sent_at) return `Emailed ${new Date(inv.invite_email_sent_at).toLocaleString()}`;
  if (inv.invite_email_error) {
    return inv.invite_email_attempts >= 5 ? 'Delivery failed — send the link manually' : `Retrying (attempt ${inv.invite_email_attempts} of 5)`;
  }
  return 'Queued'; // the mailer polls every ~20s; "not sent yet" is normal, not a failure
}

async function submit() {
  error.value = ''; success.value = '';
  if (!levelId.value) { error.value = 'Choose a level.'; return; }
  // member_profiles enforces this pairing; a mismatch would fail at signup, on the invitee.
  if (memberType.value === 'student' && !regNo.value.trim()) { error.value = 'A student invite needs a registration number.'; return; }
  if (memberType.value === 'staff' && !fetId.value.trim()) { error.value = 'A staff invite needs a FET ID.'; return; }
  submitting.value = true; lastLink.value = null; copied.value = false;
  try {
    const created = await createInvite({
      email: email.value, levelId: levelId.value, tagCodes: selectedTags.value,
      memberType: memberType.value, roleKind: roleKind.value,
      orgUnitId: orgUnitId.value || null, batchId: batchId.value || null, sectionId: sectionId.value || null,
      regNo: memberType.value === 'student' ? regNo.value.trim() : null,
      fetId: memberType.value === 'staff' ? fetId.value.trim() : null,
    });
    success.value = `Invited ${email.value}. An invite email is queued — it usually arrives within a minute.`;
    lastLink.value = inviteLink(created.invite_token);
    resetForm();
    invites.value = await listMyInvites();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Couldn't create the invite — you may not have permission to invite this level or department.";
  } finally { submitting.value = false; }
}

// One line per student: "email, reg_no". No name column — the invitee supplies their own.
const bulkRows = computed(() => bulkText.value.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
  const parts = line.split(/[,\s]+/).filter(Boolean);
  return { email: parts[0] ?? '', regNo: parts[1] ?? '' };
}));

async function submitBulk() {
  error.value = ''; success.value = '';
  const rows = bulkRows.value;
  if (!rows.length) { error.value = 'Paste at least one line: email, registration number.'; return; }
  if (!levelId.value) { error.value = 'Choose a level.'; return; }
  const bad = rows.find((r) => !r.email || !r.regNo);
  if (bad) { error.value = `Every line needs both an email and a registration number — check "${bad.email || '(blank)'}".`; return; }
  bulkBusy.value = true;
  bulkResults.value = rows.map((r) => ({ email: r.email, regNo: r.regNo, status: 'pending' as const }));
  for (let i = 0; i < rows.length; i++) {
    try {
      await createInvite({
        email: rows[i].email, levelId: levelId.value, tagCodes: selectedTags.value, memberType: 'student', roleKind: 'academic',
        orgUnitId: orgUnitId.value || null, batchId: batchId.value || null, sectionId: sectionId.value || null,
        regNo: rows[i].regNo, fetId: null,
      });
      bulkResults.value[i] = { ...bulkResults.value[i], status: 'ok' };
    } catch (e) {
      bulkResults.value[i] = { ...bulkResults.value[i], status: 'error', message: errorMessage(e, 'Failed.') };
    }
  }
  bulkBusy.value = false;
  invites.value = await listMyInvites();
}

async function resend(id: string) {
  resending.value = id; error.value = '';
  try {
    await resendInviteEmail(id);
    success.value = 'Queued for resend — it usually arrives within a minute.';
    invites.value = await listMyInvites();
  } catch (e) { error.value = errorMessage(e, 'Failed to queue the resend.'); }
  finally { resending.value = null; }
}

async function copyLink() {
  if (!lastLink.value) return;
  await navigator.clipboard.writeText(lastLink.value);
  copied.value = true;
}
</script>

<template>
  <AppHeader title="Invite" />
  <p v-if="loading" class="py-12 text-center text-p-sm text-ink-gray-5">Loading…</p>
  <div v-else class="max-w-3xl space-y-8 px-3 pb-10 pt-5 sm:px-5">
    <section class="space-y-4">
      <div>
        <h2 class="text-lg-semibold">Invite someone</h2>
        <p class="text-p-sm text-ink-gray-5">No account is created yet — they get the level and tags below automatically the moment they sign up with this email.</p>
      </div>
      <TabButtons v-model="mode" :options="[{ label: 'One invite', value: 'single' }, { label: 'Bulk invite (students)', value: 'bulk' }]" />
      <ErrorMessage :message="error" />
      <p v-if="success" class="text-p-sm text-ink-green-7">{{ success }}</p>
      <div v-if="lastLink" class="flex items-end gap-2">
        <div class="min-w-0 flex-1"><FormControl :model-value="lastLink" readonly label="Invite link (fallback if the email doesn't arrive)" /></div>
        <Button @click="copyLink">{{ copied ? 'Copied' : 'Copy' }}</Button>
      </div>

      <form v-if="mode === 'single'" class="space-y-4" @submit.prevent="submit">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormControl v-model="email" type="email" label="Email" required />
          <FormControl v-model="levelId" type="select" label="Level" :options="levelOptions" />
        </div>
        <div class="space-y-1">
          <div class="text-sm text-ink-gray-5">Tags (role identity)</div>
          <div class="flex flex-wrap gap-2">
            <Button v-for="t in tags" :key="t.id" size="sm" :variant="selectedTags.includes(t.code) ? 'solid' : 'subtle'" @click="toggleTag(t.code)">{{ t.label }}</Button>
          </div>
          <p class="text-p-sm text-ink-gray-5">Tags scope authority; the member type below decides what identifier this account needs.</p>
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormControl v-model="memberType" type="select" label="Member type" :options="typeOptions" />
          <FormControl v-model="roleKind" type="select" label="Role kind" :options="kindOptions" />
          <FormControl v-model="orgUnitId" type="select" label="Org unit (optional)" :options="unitOptions" />
          <FormControl v-model="batchId" type="select" label="Batch (optional)" :options="batchOptions" :disabled="!orgUnitId" />
          <FormControl v-model="sectionId" type="select" label="Section (optional)" :options="sectionOptions" :disabled="!batchId" />
          <FormControl v-if="memberType === 'student'" v-model="regNo" label="Registration number" />
          <FormControl v-else v-model="fetId" label="FET ID" />
        </div>
        <Button variant="solid" type="submit" :loading="submitting">Send invite</Button>
      </form>

      <div v-else class="space-y-4">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormControl v-model="levelId" type="select" label="Level" :options="levelOptions" />
          <FormControl v-model="orgUnitId" type="select" label="Org unit" :options="unitOptions" />
          <FormControl v-model="batchId" type="select" label="Batch" :options="batchOptions" :disabled="!orgUnitId" />
          <FormControl v-model="sectionId" type="select" label="Section" :options="sectionOptions" :disabled="!batchId" />
        </div>
        <div class="flex flex-wrap gap-2">
          <Button v-for="t in tags" :key="t.id" size="sm" :variant="selectedTags.includes(t.code) ? 'solid' : 'subtle'" @click="toggleTag(t.code)">{{ t.label }}</Button>
        </div>
        <FormControl
          v-model="bulkText" type="textarea" :rows="8" label="Students, one per line: email, registration number"
          placeholder="ra2211003001@srmist.edu.in, RA2211003001"
        />
        <Button variant="solid" :loading="bulkBusy" @click="submitBulk">
          Send {{ bulkRows.length || '' }} invite{{ bulkRows.length === 1 ? '' : 's' }}
        </Button>
        <ul v-if="bulkResults.length" class="divide-y divide-outline-gray-1 text-p-sm">
          <li v-for="r in bulkResults" :key="r.email" class="flex justify-between gap-3 py-1.5">
            <span class="font-mono">{{ r.email }} <span class="text-ink-gray-5">{{ r.regNo }}</span></span>
            <span v-if="r.status === 'pending'" class="text-ink-gray-5">Sending…</span>
            <span v-else-if="r.status === 'ok'" class="text-ink-green-7">Sent</span>
            <span v-else class="text-ink-red-7">{{ r.message }}</span>
          </li>
        </ul>
      </div>
    </section>

    <section class="space-y-3">
      <h3 class="text-lg-semibold">Invites you've sent</h3>
      <p v-if="!invites.length" class="text-p-sm text-ink-gray-5">No invites yet.</p>
      <div v-else class="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <table class="w-full text-left text-p-sm">
        <thead class="border-b text-ink-gray-5">
          <tr><th class="py-2 font-normal">Email</th><th class="font-normal">Status</th><th class="font-normal">Delivery</th><th class="font-normal">Created</th><th /></tr>
        </thead>
        <tbody class="divide-y divide-outline-gray-1">
          <tr v-for="inv in invites" :key="inv.id">
            <td class="py-2.5">{{ inv.email }}</td>
            <td><Badge :theme="inv.consumed_at ? 'green' : 'blue'" :label="inv.consumed_at ? 'Joined' : 'Pending'" /></td>
            <td class="text-ink-gray-5">{{ deliveryLabel(inv) }}</td>
            <td class="tabular-nums text-ink-gray-5">{{ new Date(inv.created_at).toLocaleDateString() }}</td>
            <td class="text-right">
              <template v-if="!inv.consumed_at">
                <Button variant="ghost" aria-label="Resend invite email" :disabled="resending === inv.id" @click="resend(inv.id)">
                  <span class="lucide-send size-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" aria-label="Revoke invite" @click="revoking = inv; showRevoke = true">
                  <span class="lucide-x size-4" aria-hidden="true" />
                </Button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
</div>
    </section>
  </div>

  <ConfirmDestructive
    v-if="revoking" v-model:open="showRevoke" title="Revoke invite" :record-name="revoking.email"
    :description="`Revoking the invite for &quot;${revoking.email}&quot;.`"
    :on-confirmed="async () => { await revokeInvite(revoking!.id); invites = invites.filter((i) => i.id !== revoking!.id); }"
  />
</template>
