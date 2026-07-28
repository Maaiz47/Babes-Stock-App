'use client';

import { useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { DateInput } from '@/components/ui/date-input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  FOOD_LABELS,
  FREQUENCY_DEFAULT_TIMES,
  FREQUENCY_LABELS,
  addDays,
  type FoodInstruction,
  type FrequencyCode,
  type Medication,
  type MedicationInput,
} from '@/lib/meds';
import { MED_COLORS, MED_COLOR_TOKENS, formatMedDateLong } from './MedChecklist';

const FORMS = [
  'tablet',
  'capsule',
  'chewable tablet',
  'ointment',
  'syrup',
  'drops',
  'other',
] as const;

const FREQUENCY_ORDER: FrequencyCode[] = ['OD', 'BD', 'TDS', 'QDS', 'CUSTOM'];
const FOOD_ORDER: FoodInstruction[] = ['before_food', 'with_food', 'after_food', 'any'];

/**
 * The page mounts this only while it is open, keyed by medicine id, so the form
 * state is rebuilt from scratch on every open — no reset effect needed.
 */
export interface MedicineEditorProps {
  open: boolean;
  onClose: () => void;
  /** null = create a new medicine. */
  medication: Medication | null;
  /** Start date used for a brand new medicine. */
  defaultStartDate: string;
  /** sort_order given to a brand new medicine. */
  nextSortOrder: number;
  onSaved: () => void | Promise<void>;
}

interface FormState {
  name: string;
  strength: string;
  form: string;
  dose_label: string;
  frequency_code: FrequencyCode;
  times_of_day: string[];
  start_date: string;
  duration_days: string;
  food_instruction: FoodInstruction;
  notes: string;
  color: string;
  active: boolean;
}

function initialState(medication: Medication | null, defaultStartDate: string): FormState {
  if (medication) {
    return {
      name: medication.name,
      strength: medication.strength ?? '',
      form: medication.form,
      dose_label: medication.dose_label,
      frequency_code: medication.frequency_code,
      times_of_day: [...medication.times_of_day].sort(),
      start_date: medication.start_date,
      duration_days: medication.duration_days == null ? '' : String(medication.duration_days),
      food_instruction: medication.food_instruction,
      notes: medication.notes ?? '',
      color: medication.color,
      active: medication.active,
    };
  }
  return {
    name: '',
    strength: '',
    form: 'tablet',
    dose_label: '1 tablet',
    frequency_code: 'OD',
    times_of_day: [...FREQUENCY_DEFAULT_TIMES.OD],
    start_date: defaultStartDate,
    duration_days: '',
    food_instruction: 'any',
    notes: '',
    color: 'violet',
    active: true,
  };
}

export function MedicineEditor({
  open,
  onClose,
  medication,
  defaultStartDate,
  nextSortOrder,
  onSaved,
}: MedicineEditorProps) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(medication, defaultStartDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [timesError, setTimesError] = useState('');

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const endsLabel = useMemo(() => {
    const days = Number(form.duration_days);
    if (!form.duration_days.trim() || !Number.isFinite(days) || days < 1) return null;
    if (!form.start_date) return null;
    return formatMedDateLong(addDays(form.start_date, days - 1));
  }, [form.duration_days, form.start_date]);

  const changeFrequency = (code: FrequencyCode) => {
    setTimesError('');
    setForm((f) => ({
      ...f,
      frequency_code: code,
      // Prefill from the defaults; every time stays individually editable below.
      times_of_day: [...FREQUENCY_DEFAULT_TIMES[code]],
    }));
  };

  const setTimeAt = (index: number, value: string) => {
    setTimesError('');
    setForm((f) => {
      const next = [...f.times_of_day];
      next[index] = value;
      return { ...f, times_of_day: next };
    });
  };

  /** Sort + reject duplicates once the user leaves the field. */
  const commitTimes = () => {
    const cleaned = form.times_of_day.filter((t) => t);
    const unique = Array.from(new Set(cleaned));
    setTimesError(
      unique.length === cleaned.length
        ? ''
        : 'That time was already in the list — the duplicate was removed.'
    );

    const sorted = unique.sort();
    const times = sorted.length ? sorted : ['08:00'];
    // Keep the frequency code honest if the number of times no longer matches it.
    const frequency: FrequencyCode =
      form.frequency_code !== 'CUSTOM' &&
      times.length !== FREQUENCY_DEFAULT_TIMES[form.frequency_code].length
        ? 'CUSTOM'
        : form.frequency_code;

    setForm((f) => ({ ...f, times_of_day: times, frequency_code: frequency }));
  };

  const addTime = () => {
    setTimesError('');
    setForm((f) => {
      const taken = new Set(f.times_of_day);
      let hour = 8;
      let candidate = '08:00';
      while (taken.has(candidate) && hour < 23) {
        hour += 1;
        candidate = `${String(hour).padStart(2, '0')}:00`;
      }
      if (taken.has(candidate)) return f;
      const sorted = [...f.times_of_day, candidate].sort();
      return {
        ...f,
        times_of_day: sorted,
        frequency_code:
          sorted.length === FREQUENCY_DEFAULT_TIMES[f.frequency_code].length
            ? f.frequency_code
            : 'CUSTOM',
      };
    });
  };

  const removeTime = (index: number) => {
    setTimesError('');
    setForm((f) => {
      if (f.times_of_day.length <= 1) return f;
      const sorted = f.times_of_day.filter((_, i) => i !== index).sort();
      return {
        ...f,
        times_of_day: sorted,
        frequency_code:
          sorted.length === FREQUENCY_DEFAULT_TIMES[f.frequency_code].length
            ? f.frequency_code
            : 'CUSTOM',
      };
    });
  };

  const save = async () => {
    setError('');

    const name = form.name.trim();
    const doseLabel = form.dose_label.trim();
    if (!name) return setError('Give the medicine a name.');
    if (!doseLabel) return setError('Say how much to take, e.g. "1 tablet".');
    if (!form.start_date) return setError('Pick a start date.');

    const times = Array.from(new Set(form.times_of_day.filter((t) => t))).sort();
    if (times.length === 0) return setError('Add at least one time of day.');

    let duration: number | null = null;
    if (form.duration_days.trim()) {
      const parsed = Number(form.duration_days);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return setError('Duration must be at least 1 day, or blank for an ongoing medicine.');
      }
      duration = Math.floor(parsed);
    }

    const payload: MedicationInput = {
      name,
      strength: form.strength.trim() || null,
      form: form.form,
      dose_label: doseLabel,
      frequency_code: form.frequency_code,
      times_of_day: times,
      start_date: form.start_date,
      duration_days: duration,
      food_instruction: form.food_instruction,
      notes: form.notes.trim() || null,
      color: form.color,
      active: form.active,
      sort_order: medication ? medication.sort_order : nextSortOrder,
    };

    setSaving(true);
    try {
      const res = await fetch(
        medication ? `/api/meds/medications/${medication.id}` : '/api/meds/medications',
        {
          method: medication ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = String(json?.error ?? 'Could not save the medicine');
        setError(message);
        toast.error('Save failed', message);
        return;
      }
      toast.success(medication ? 'Medicine updated' : 'Medicine added', name);
      await onSaved();
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      setError(message);
      toast.error('Save failed', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? () => {} : onClose}
      title={medication ? 'Edit medicine' : 'Add medicine'}
      description="Copy this straight from the prescription label — never guess a dose."
      size="lg"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2">
            <Input
              value={form.name}
              onChange={(e) => patch('name', e.target.value)}
              placeholder="Pantoprazole"
              style={{ fontSize: '16px' }}
            />
          </Field>

          <Field label="Strength">
            <Input
              value={form.strength}
              onChange={(e) => patch('strength', e.target.value)}
              placeholder="40 mg"
              style={{ fontSize: '16px' }}
            />
          </Field>

          <Field label="Form">
            <Select value={form.form} onChange={(e) => patch('form', e.target.value)}>
              {FORMS.map((f) => (
                <option key={f} value={f} className="bg-gray-900">
                  {f}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="How much to take" className="col-span-2">
            <Input
              value={form.dose_label}
              onChange={(e) => patch('dose_label', e.target.value)}
              placeholder="1 tablet"
              style={{ fontSize: '16px' }}
            />
          </Field>
        </div>

        <Field label="How often">
          <Select
            value={form.frequency_code}
            onChange={(e) => changeFrequency(e.target.value as FrequencyCode)}
          >
            {FREQUENCY_ORDER.map((code) => (
              <option key={code} value={code} className="bg-gray-900">
                {FREQUENCY_LABELS[code]}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-[11px] text-gray-500">
            Choosing a frequency fills in suggested times — you can still change each one.
          </p>
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">Times of day</span>
            <Button variant="ghost" size="sm" onClick={addTime}>
              <Plus size={13} />
              Add time
            </Button>
          </div>
          <div className="space-y-2">
            {form.times_of_day.map((time, index) => (
              <div key={`${index}-${time}`} className="flex items-center gap-2">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTimeAt(index, e.target.value)}
                  onBlur={commitTimes}
                  style={{ fontSize: '16px' }}
                  className={cn(
                    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-gray-100',
                    'focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/50',
                    '[color-scheme:dark]'
                  )}
                />
                <button
                  type="button"
                  onClick={() => removeTime(index)}
                  disabled={form.times_of_day.length <= 1}
                  aria-label={`Remove ${time}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/8 hover:text-rose-400 disabled:pointer-events-none disabled:opacity-30"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          {timesError && <p className="mt-1.5 text-[11px] text-amber-400">{timesError}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <DateInput value={form.start_date} onChange={(v) => patch('start_date', v)} />
          </Field>
          <Field label="Duration (days)">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={form.duration_days}
              onChange={(e) => patch('duration_days', e.target.value)}
              placeholder="Ongoing"
              style={{ fontSize: '16px' }}
            />
          </Field>
        </div>
        <p className="-mt-3 text-[11px] text-gray-500">
          {endsLabel ? (
            <>
              Ends <span className="font-medium text-gray-300">{endsLabel}</span>
            </>
          ) : (
            'Leave the duration blank for an ongoing medicine.'
          )}
        </p>

        <Field label="Food instruction">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1.5 sm:grid-cols-4">
            {FOOD_ORDER.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => patch('food_instruction', code)}
                aria-pressed={form.food_instruction === code}
                className={cn(
                  'rounded-lg px-2 py-2 text-xs font-medium transition-colors',
                  form.food_instruction === code
                    ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                )}
              >
                {FOOD_LABELS[code]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => patch('notes', e.target.value)}
            rows={3}
            placeholder="Anything the pharmacist or doctor said about this medicine"
            style={{ fontSize: '16px' }}
            className={cn(
              'w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-gray-100 placeholder:text-gray-500',
              'focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/50'
            )}
          />
        </Field>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2.5">
            {MED_COLOR_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => patch('color', token)}
                aria-label={token}
                aria-pressed={form.color === token}
                className={cn(
                  'h-9 w-9 rounded-full transition-transform',
                  MED_COLORS[token].dot,
                  form.color === token
                    ? 'scale-110 ring-2 ring-white/70 ring-offset-2 ring-offset-gray-900'
                    : 'opacity-60 hover:opacity-100'
                )}
              />
            ))}
          </div>
        </Field>

        <button
          type="button"
          onClick={() => patch('active', !form.active)}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition-colors hover:bg-white/[0.06]"
        >
          <span>
            <span className="block text-sm font-medium text-gray-200">Active</span>
            <span className="mt-0.5 block text-[11px] text-gray-500">
              Turn off to stop reminders without deleting the medicine.
            </span>
          </span>
          <span
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors',
              form.active ? 'bg-emerald-500' : 'bg-white/15'
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
                form.active ? 'left-[22px]' : 'left-0.5'
              )}
            />
          </span>
        </button>

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="flex gap-2 border-t border-white/8 pt-4">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={save} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {medication ? 'Save changes' : 'Add medicine'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium text-gray-400">{label}</label>
      {children}
    </div>
  );
}
