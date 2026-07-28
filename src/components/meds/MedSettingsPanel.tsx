'use client';

import { useEffect, useRef, useState } from 'react';
import { BellRing, Check, Loader2, Minus, Plus, Send, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { MALDIVES_OFFSET_MIN, type MedSettings } from '@/lib/meds';

const SOUNDS = [
  { value: 'siren', label: 'Siren — loudest' },
  { value: 'chime', label: 'Chime — gentle' },
  { value: 'pulse', label: 'Pulse — repeating beep' },
];

/** UTC-12:00 … UTC+14:00 in 30 minute steps. */
const TZ_OPTIONS = (() => {
  const out: { value: number; label: string }[] = [];
  for (let minutes = -720; minutes <= 840; minutes += 30) {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    const suffix = minutes === MALDIVES_OFFSET_MIN ? ' — Maldives' : '';
    out.push({ value: minutes, label: `UTC${sign}${hh}:${mm}${suffix}` });
  }
  return out;
})();

export interface MedSettingsPanelProps {
  settings: MedSettings | null;
  onSettingsChange: (settings: MedSettings) => void;
  onTestAlarm: () => void;
  onEnableAlarms: () => Promise<void>;
  permission: NotificationPermission;
  pushEnabled: boolean;
  audioUnlocked: boolean;
  supported: boolean;
}

export function MedSettingsPanel({
  settings,
  onSettingsChange,
  onTestAlarm,
  onEnableAlarms,
  permission,
  pushEnabled,
  audioUnlocked,
  supported,
}: MedSettingsPanelProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<MedSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [testing, setTesting] = useState(false);

  const pendingRef = useRef<Partial<MedSettings>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => {});

  // Adopt fresh server state only when nothing local is queued.
  useEffect(() => {
    if (Object.keys(pendingRef.current).length === 0) setDraft(settings);
  }, [settings]);

  const flush = async () => {
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/meds/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not save settings'));
      onSettingsChange(json.settings as MedSettings);
    } catch (e) {
      toast.error('Settings not saved', e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    flushRef.current = flush;
  });

  // Never lose a pending edit when she navigates away.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      flushRef.current();
    },
    []
  );

  const update = (patch: Partial<MedSettings>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushRef.current();
    }, 500);
  };

  const enableAlarms = async () => {
    setEnabling(true);
    try {
      await onEnableAlarms();
    } catch (e) {
      toast.error('Could not turn on alarms', e instanceof Error ? e.message : undefined);
    } finally {
      setEnabling(false);
    }
  };

  const sendTestNotification = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/meds/push/test', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not send the test'));
      const sent = Number(json?.sent ?? 0);
      if (sent > 0) {
        toast.success('Test notification sent', `Delivered to ${sent} device${sent === 1 ? '' : 's'}`);
      } else {
        toast.warning('No devices registered', 'Tap "Turn on alarms" on this device first.');
      }
    } catch (e) {
      toast.error('Test failed', e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setTesting(false);
    }
  };

  if (!draft) {
    return (
      <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-10 text-center text-sm text-gray-500">
        Loading settings…
      </div>
    );
  }

  const quietHoursOn = Boolean(draft.quiet_hours_start && draft.quiet_hours_end);
  const alarmsReady = permission === 'granted' && audioUnlocked;

  return (
    <div className="space-y-4">
      <section
        className={cn(
          'rounded-2xl border p-4',
          alarmsReady
            ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
            : 'border-amber-500/30 bg-amber-500/[0.08]'
        )}
      >
        <div className="flex items-start gap-3">
          <BellRing size={16} className={alarmsReady ? 'mt-0.5 text-emerald-400' : 'mt-0.5 text-amber-400'} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">
              {alarmsReady ? 'Alarms are on for this device' : 'Alarms are off for this device'}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              {supported
                ? 'iPhone will not play a sound or show a reminder until you tap this once on this device.'
                : 'This browser cannot show notifications. Add the app to your Home Screen and open it from there.'}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusPill ok={permission === 'granted'} label="Notifications" />
              <StatusPill ok={audioUnlocked} label="Sound" />
              <StatusPill ok={pushEnabled} label="Push" />
            </div>
            {supported && !alarmsReady && (
              <Button className="mt-3" onClick={enableAlarms} disabled={enabling}>
                {enabling && <Loader2 size={14} className="animate-spin" />}
                Turn on alarms
              </Button>
            )}
            {permission === 'denied' && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-300">
                Notifications were blocked. Turn them back on in iPhone Settings → Notifications for
                this app, then tap the button again.
              </p>
            )}
          </div>
        </div>
      </section>

      <Card title="Alarm" saving={saving}>
        <ToggleRow
          label="Alarm enabled"
          hint="Turn everything off without losing your schedule."
          checked={draft.alarm_enabled}
          onChange={(v) => update({ alarm_enabled: v })}
        />

        <Row label="Sound">
          <Select
            value={draft.alarm_sound}
            onChange={(e) => update({ alarm_sound: e.target.value })}
            className="max-w-[190px]"
          >
            {SOUNDS.map((s) => (
              <option key={s.value} value={s.value} className="bg-gray-900">
                {s.label}
              </option>
            ))}
          </Select>
        </Row>

        <div className="py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-gray-200">
              <Volume2 size={14} className="text-gray-500" />
              Volume
            </span>
            <span className="font-mono text-xs text-gray-400 tabular-nums">
              {Math.round(draft.alarm_volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.alarm_volume}
            onChange={(e) => update({ alarm_volume: Number(e.target.value) })}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-violet-500"
            aria-label="Alarm volume"
          />
        </div>

        <Stepper
          label="Repeat every"
          suffix="min"
          value={draft.repeat_interval_min}
          min={1}
          max={60}
          onChange={(v) => update({ repeat_interval_min: v })}
        />
        <Stepper
          label="Stop after"
          suffix="reminders"
          value={draft.max_repeats}
          min={1}
          max={60}
          onChange={(v) => update({ max_repeats: v })}
        />
        <Stepper
          label="Snooze length"
          suffix="min"
          value={draft.snooze_min}
          min={1}
          max={120}
          onChange={(v) => update({ snooze_min: v })}
        />

        <div className="flex flex-wrap gap-2 pt-3">
          <Button variant="outline" onClick={onTestAlarm}>
            <BellRing size={14} />
            Test alarm
          </Button>
          <Button variant="outline" onClick={sendTestNotification} disabled={testing}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send test notification
          </Button>
        </div>
      </Card>

      <Card title="Quiet hours" saving={saving}>
        <ToggleRow
          label="Silence alarms overnight"
          hint="Reminders still appear — they just will not make a sound."
          checked={quietHoursOn}
          onChange={(v) =>
            update(
              v
                ? { quiet_hours_start: '22:00', quiet_hours_end: '07:00' }
                : { quiet_hours_start: null, quiet_hours_end: null }
            )
          }
        />
        {quietHoursOn && (
          <div className="grid grid-cols-2 gap-3 pt-3">
            <TimeField
              label="From"
              value={draft.quiet_hours_start ?? '22:00'}
              onChange={(v) => update({ quiet_hours_start: v })}
            />
            <TimeField
              label="Until"
              value={draft.quiet_hours_end ?? '07:00'}
              onChange={(v) => update({ quiet_hours_end: v })}
            />
          </div>
        )}
      </Card>

      <Card title="Timezone" saving={saving}>
        <Row label="Local time offset">
          <Select
            value={String(draft.tz_offset_minutes)}
            onChange={(e) => update({ tz_offset_minutes: Number(e.target.value) })}
            className="max-w-[190px]"
          >
            {TZ_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value} className="bg-gray-900">
                {tz.label}
              </option>
            ))}
          </Select>
        </Row>
        <p className="pb-1 text-[11px] leading-relaxed text-gray-500">
          Every dose time is read in this timezone. Leave it on UTC+05:00 while you are in the
          Maldives.
        </p>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- bits */

function Card({
  title,
  saving,
  children,
}: {
  title: string;
  saving: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
          {title}
        </h3>
        {saving && (
          <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <Loader2 size={10} className="animate-spin" />
            Saving
          </span>
        )}
      </div>
      <div className="divide-y divide-white/8">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-sm text-gray-200">{label}</span>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full items-center justify-between gap-3 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm text-gray-200">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">{hint}</span>}
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-emerald-500' : 'bg-white/15'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
            checked ? 'left-[22px]' : 'left-0.5'
          )}
        />
      </span>
    </button>
  );
}

function Stepper({
  label,
  suffix,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-sm text-gray-200">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
        >
          <Minus size={14} />
        </button>
        <span className="w-20 text-center font-mono text-sm text-white tabular-nums">
          {value} <span className="text-[10px] text-gray-500">{suffix}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-400">{label}</label>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: '16px' }}
        className={cn(
          'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-gray-100',
          'focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/50',
          '[color-scheme:dark]'
        )}
      />
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
        ok
          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
          : 'border-white/10 bg-white/5 text-gray-500'
      )}
    >
      {ok && <Check size={9} strokeWidth={3} />}
      {label}
    </span>
  );
}
