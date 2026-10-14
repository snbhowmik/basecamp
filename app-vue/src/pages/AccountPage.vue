<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { PageHeader, PageHeaderTitle, FormControl, Button, ErrorMessage, Badge, useColorScheme } from 'frappe-ui';
import SignaturePad from '../components/SignaturePad.vue';
import { session, bootstrap } from '../lib/session';
import {
  listMfaFactors, beginMfaReenroll, confirmMfaReenroll, cancelMfaEnroll, updateProfile, changePassword,
  getMemberDetails, type MfaFactorSummary, type MemberDetails,
} from '../lib/account';
import { errorMessage } from '../lib/requests';

const ctx = computed(() => session.ctx!);
const { colorScheme, setColorScheme } = useColorScheme();

const factors = ref<MfaFactorSummary[]>([]);
const member = ref<MemberDetails | null>(null);
const loading = ref(true);

const fullName = ref(ctx.value.profile.full_name);
const profileMsg = ref(''); const profileErr = ref(''); const savingProfile = ref(false);
const password = ref('');
const passwordMsg = ref(''); const passwordErr = ref(''); const savingPassword = ref(false);
const reenroll = ref<{ id: string; qr: string; secret: string } | null>(null);
const totpCode = ref('');
const mfaErr = ref(''); const mfaMsg = ref(''); const busyMfa = ref(false);

onMounted(async () => {
  try {
    const [f, m] = await Promise.all([listMfaFactors(), getMemberDetails(ctx.value.profile.id).catch(() => null)]);
    factors.value = f; member.value = m;
  } finally { loading.value = false; }
});

const verified = computed(() => factors.value.filter((f) => f.status === 'verified'));

async function saveProfile() {
  savingProfile.value = true; profileErr.value = ''; profileMsg.value = '';
  try { await updateProfile({ full_name: fullName.value.trim() }); profileMsg.value = 'Profile updated.'; await bootstrap(); }
  catch (e) { profileErr.value = errorMessage(e, 'Could not update profile.'); }
  finally { savingProfile.value = false; }
}

async function savePassword() {
  if (password.value.length < 8) { passwordErr.value = 'Password must be at least 8 characters.'; return; }
  savingPassword.value = true; passwordErr.value = ''; passwordMsg.value = '';
  try { await changePassword(password.value); password.value = ''; passwordMsg.value = 'Password changed.'; }
  catch (e) { passwordErr.value = errorMessage(e, 'Could not change password.'); }
  finally { savingPassword.value = false; }
}

async function startReenroll() {
  busyMfa.value = true; mfaErr.value = ''; mfaMsg.value = '';
  try { const e = await beginMfaReenroll(); reenroll.value = { id: e.id, qr: e.totp.qr_code, secret: e.totp.secret }; }
  catch (e) { mfaErr.value = errorMessage(e, 'Could not start re-enrollment.'); }
  finally { busyMfa.value = false; }
}

async function finishReenroll() {
  if (!reenroll.value) return;
  busyMfa.value = true; mfaErr.value = '';
  try {
    const oldIds = factors.value.filter((f) => f.status === 'verified' && f.id !== reenroll.value!.id).map((f) => f.id);
    await confirmMfaReenroll(reenroll.value.id, totpCode.value, oldIds);
    reenroll.value = null; totpCode.value = '';
    mfaMsg.value = 'Authenticator replaced. Use the new one from your next sign-in.';
    factors.value = await listMfaFactors();
  } catch (e) { mfaErr.value = errorMessage(e, 'Verification failed — check the code and try again.'); }
  finally { busyMfa.value = false; }
}

async function abortReenroll() {
  if (!reenroll.value) return;
  await cancelMfaEnroll(reenroll.value.id).catch(() => {});
  reenroll.value = null; totpCode.value = ''; mfaErr.value = '';
}

const themeOptions = [{ label: 'System', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }];
</script>

<template>
  <PageHeader><PageHeaderTitle title="My account" /></PageHeader>
  <p v-if="loading" class="py-12 text-center text-p-sm text-ink-gray-5">Loading…</p>
  <div v-else class="max-w-3xl space-y-10 p-5">
    <p class="text-p-sm text-ink-gray-5">Your details, password, and authenticator.</p>

    <section class="space-y-3">
      <h2 class="text-lg-semibold">Appearance</h2>
      <div class="w-48"><FormControl :model-value="colorScheme" type="select" label="Theme" :options="themeOptions" @update:model-value="setColorScheme($event as 'light' | 'dark' | 'system')" /></div>
    </section>

    <section class="space-y-4">
      <h2 class="text-lg-semibold">Profile</h2>
      <dl class="grid grid-cols-[9rem_1fr] gap-y-2 text-p-sm">
        <dt class="text-ink-gray-5">Email</dt><dd>{{ ctx.profile.email }}</dd>
        <dt class="text-ink-gray-5">Role</dt><dd>{{ ctx.isCaptain ? 'Captain' : ctx.isStaff ? 'Staff' : 'Student' }}</dd>
        <template v-if="member">
          <dt class="text-ink-gray-5">{{ member.member_type === 'staff' ? 'FET ID' : 'Registration number' }}</dt>
          <dd>{{ (member.member_type === 'staff' ? member.fet_id : member.reg_no) ?? 'Not set' }}</dd>
          <dt class="text-ink-gray-5">Org unit</dt><dd>{{ member.org_units?.name ?? '—' }}</dd>
          <template v-if="member.member_type === 'student'">
            <dt class="text-ink-gray-5">Batch</dt><dd>{{ member.batches?.name ?? 'Not set' }}</dd>
            <dt class="text-ink-gray-5">Section</dt><dd>{{ member.sections?.name ?? 'Not set' }}</dd>
          </template>
        </template>
        <dt class="text-ink-gray-5">Tags</dt>
        <dd><span v-if="!ctx.tagCodes.length">None</span><span class="flex flex-wrap gap-1"><Badge v-for="t in ctx.tagCodes" :key="t" :label="t" /></span></dd>
      </dl>
      <form class="max-w-md space-y-3" @submit.prevent="saveProfile">
        <ErrorMessage :message="profileErr" />
        <p v-if="profileMsg" class="text-p-sm text-ink-green-7">{{ profileMsg }}</p>
        <FormControl v-model="fullName" label="Full name" required />
        <Button variant="solid" type="submit" :loading="savingProfile">Save changes</Button>
      </form>
    </section>

    <section class="space-y-3">
      <h2 class="text-lg-semibold">Authenticator</h2>
      <ErrorMessage :message="mfaErr" />
      <p v-if="mfaMsg" class="text-p-sm text-ink-green-7">{{ mfaMsg }}</p>
      <template v-if="!reenroll">
        <p class="text-p-sm text-ink-gray-5">
          {{ verified.length ? `${verified.length} authenticator${verified.length > 1 ? 's' : ''} enrolled. Replacing it will invalidate the old one once you confirm the new code.` : 'No authenticator enrolled.' }}
        </p>
        <Button :loading="busyMfa" @click="startReenroll">Replace authenticator</Button>
        <p class="text-p-sm text-ink-gray-5">Locked out entirely and can't sign in? This page can't help — an administrator has to reset it for you.</p>
      </template>
      <form v-else class="max-w-sm space-y-3" @submit.prevent="finishReenroll">
        <div class="flex justify-center"><img :src="reenroll.qr" alt="Scan with your authenticator app" width="170" height="170" class="rounded-6 border bg-white p-3" /></div>
        <div class="space-y-1"><div class="text-sm text-ink-gray-5">Or enter this key manually</div><code class="block break-all rounded-4 border bg-surface-gray-1 p-2 text-p-sm">{{ reenroll.secret }}</code></div>
        <FormControl v-model="totpCode" label="6-digit code from the new app" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required />
        <div class="flex gap-2">
          <Button :disabled="busyMfa" @click="abortReenroll">Cancel</Button>
          <Button variant="solid" type="submit" :loading="busyMfa">Confirm new authenticator</Button>
        </div>
      </form>
    </section>

    <section class="space-y-3">
      <h2 class="text-lg-semibold">Password</h2>
      <form class="max-w-md space-y-3" @submit.prevent="savePassword">
        <ErrorMessage :message="passwordErr" />
        <p v-if="passwordMsg" class="text-p-sm text-ink-green-7">{{ passwordMsg }}</p>
        <FormControl v-model="password" type="password" label="New password" placeholder="At least 8 characters" autocomplete="new-password" required />
        <Button variant="solid" type="submit" :loading="savingPassword">Change password</Button>
      </form>
    </section>

    <!-- Only staff sign documents; a student has nothing to stamp. isStaff is is_lowest_level() === false. -->
    <SignaturePad v-if="ctx.isStaff" />
  </div>
</template>
