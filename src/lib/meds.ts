import { sql } from '@vercel/postgres';

/**
 * Medicine reminder module.
 *
 * Design note: scheduled doses are NOT pre-generated as rows. The daily schedule
 * is computed on the fly from the medication definitions, and only *actioned*
 * doses (taken / skipped / snoozed) are persisted in `medication_doses`.
 * This means editing a medicine's times never orphans or duplicates rows.
 */

// ---------------------------------------------------------------- types

export type FrequencyCode = 'OD' | 'BD' | 'TDS' | 'QDS' | 'CUSTOM';
export type FoodInstruction = 'before_food' | 'with_food' | 'after_food' | 'any';
export type DoseStatus = 'pending' | 'taken' | 'skipped';

export interface Medication {
  id: string;
  user_id: string;
  name: string;
  strength: string | null;
  form: string;               // tablet | capsule | ointment | syrup | injection | other
  dose_label: string;         // "1 tablet", "Apply thin layer"
  frequency_code: FrequencyCode;
  times_of_day: string[];     // ['08:00','20:00'] — local (user tz)
  start_date: string;         // YYYY-MM-DD
  duration_days: number | null; // null = ongoing
  /**
   * Shortest acceptable gap between two doses of THIS medicine, in minutes.
   *
   * When a dose is taken late, the next one's reminder is pushed back so it
   * still lands at least this far after the tablet she actually swallowed —
   * taking the 08:00 Metronidazole at 10:30 should not leave the 14:00 dose
   * only three and a half hours behind it.
   *
   * null means "derive it from this medicine's own times" (see
   * defaultMinGapMinutes), so the default tracks the schedule rather than a
   * frequency label: TDS at 08:00/14:00/20:00 is 6h apart by day, and a gap
   * derived from that is right where one derived from "three times daily"
   * would not be.
   */
  min_gap_minutes: number | null;
  food_instruction: FoodInstruction;
  notes: string | null;
  color: string;              // tailwind-ish token used by the UI
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * `min_gap_minutes` is optional here, and omitting it stores null — which means
 * "derive the gap from this medicine's own times". That is the right default for
 * almost every medicine, so callers should have to opt IN to overriding it.
 */
export type MedicationInput =
  Omit<Medication, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'min_gap_minutes'>
  & { min_gap_minutes?: number | null };

export interface MedSettings {
  user_id: string;
  tz_offset_minutes: number;  // Maldives = +300
  alarm_enabled: boolean;
  alarm_sound: string;        // siren | chime | pulse
  alarm_volume: number;       // 0..1
  repeat_interval_min: number;
  max_repeats: number;
  snooze_min: number;
  updated_at: string;
}

/**
 * A dated appointment shown alongside the schedule.
 *
 * Deliberately stored per user in the database rather than hard-coded in this
 * module: /meds is a client component, so anything constant in here can end up
 * in a public JS chunk. Appointments are served only through the 403-gated API.
 */
export interface Appointment {
  id: string;
  user_id: string;
  label: string;
  date: string;               // YYYY-MM-DD
  detail: string | null;
  created_at: string;
}

export type AppointmentInput = Pick<Appointment, 'label' | 'date'> & { detail?: string | null };

/** A single expected dose on a given day, with whatever action was logged against it. */
export interface ScheduledDose {
  key: string;                // `${medication_id}|${scheduled_at ISO}`
  medication_id: string;
  name: string;
  strength: string | null;
  form: string;
  dose_label: string;
  food_instruction: FoodInstruction;
  notes: string | null;
  color: string;
  time: string;               // HH:MM local
  scheduled_at: string;       // ISO UTC instant
  status: DoseStatus;
  taken_at: string | null;
  snoozed_until: string | null;
  /**
   * When this dose should actually be reminded about — `scheduled_at`, unless
   * the PREVIOUS dose of the same medicine was taken late enough that keeping
   * the original time would break the minimum gap. Never earlier than
   * `scheduled_at`; a dose taken early never pulls the next one forward.
   *
   * The dose's identity stays keyed on `scheduled_at`, so deferring changes
   * only when she is nudged, never which dose this is. That is what keeps the
   * log join, the adherence count and the schedule stable.
   */
  effective_at: string;
  /** 0 when not deferred. Drives the "moved to HH:MM" explanation in the UI. */
  deferred_by_minutes: number;
  /** The actual taken-time of the previous dose that caused the deferral. */
  defer_after_taken_at: string | null;
}

/**
 * A dose the dispatcher should remind about right now.
 *
 * There is deliberately no "silent" flag. This module only ever reminds about
 * medicine, so every reminder it emits must be audible: a 22:00 antibiotic dose
 * is exactly the one that has to wake her. Nothing here may suppress sound based
 * on the time of day.
 */
export interface DueDose extends ScheduledDose {
  user_id: string;
  overdue_minutes: number;
}

// ---------------------------------------------------------------- constants

export const MALDIVES_OFFSET_MIN = 300; // UTC+5, no DST

export const FREQUENCY_LABELS: Record<FrequencyCode, string> = {
  OD: 'Once daily',
  BD: 'Twice daily',
  TDS: 'Three times daily',
  QDS: 'Four times daily',
  CUSTOM: 'Custom',
};

export const FREQUENCY_DEFAULT_TIMES: Record<FrequencyCode, string[]> = {
  OD: ['08:00'],
  BD: ['08:00', '20:00'],
  TDS: ['08:00', '14:00', '20:00'],
  QDS: ['06:00', '12:00', '18:00', '22:00'],
  CUSTOM: ['08:00'],
};

export const FOOD_LABELS: Record<FoodInstruction, string> = {
  before_food: 'Before food',
  with_food: 'With food',
  after_food: 'After food',
  any: 'Any time',
};

/**
 * Defaults transcribed from the prescription dated 27 Jul 2026.
 * Times are chosen to respect each drug's food requirements:
 *  - Pantoprazole: 30–60 min before breakfast (empty stomach)
 *  - Trypsin + Chymotrypsin: empty stomach, ~30 min before meals
 *  - Metronidazole / Diclofenac: after food (GI irritation)
 */
export const PRESCRIPTION_DEFAULTS: Omit<MedicationInput, 'start_date'>[] = [
  {
    name: 'Pantoprazole',
    strength: '40 mg',
    form: 'tablet',
    dose_label: '1 tablet',
    frequency_code: 'OD',
    times_of_day: ['07:00'],
    duration_days: 7,
    food_instruction: 'before_food',
    notes: 'Take 30–60 minutes before breakfast, on an empty stomach.',
    color: 'sky',
    active: true,
    sort_order: 1,
  },
  {
    name: 'Trypsin + Chymotrypsin',
    strength: '100,000 units',
    form: 'tablet',
    dose_label: '1 tablet',
    frequency_code: 'TDS',
    times_of_day: ['07:00', '13:00', '19:00'],
    duration_days: 7,
    food_instruction: 'before_food',
    notes: 'Chymoral Forte. Empty stomach — about 30 minutes before a meal. Swallow whole, do not crush.',
    color: 'violet',
    active: true,
    sort_order: 2,
  },
  {
    name: 'Cefixime + Lactobacillus',
    strength: '200 mg + 60 million spores',
    form: 'tablet',
    dose_label: '1 tablet',
    frequency_code: 'BD',
    times_of_day: ['08:00', '20:00'],
    duration_days: 7,
    food_instruction: 'any',
    notes: 'Cefo L. Antibiotic — finish the full 7 day course even if you feel better.',
    color: 'emerald',
    active: true,
    sort_order: 3,
  },
  {
    name: 'Metronidazole',
    strength: '400 mg',
    form: 'tablet',
    dose_label: '1 tablet',
    frequency_code: 'TDS',
    times_of_day: ['08:00', '14:00', '20:00'],
    duration_days: 5,
    food_instruction: 'after_food',
    notes: 'Flagyl. Take after food. Do NOT drink alcohol during the course or for 48 hours after.',
    color: 'amber',
    active: true,
    sort_order: 4,
  },
  {
    name: 'Diclofenac Sodium',
    strength: '50 mg',
    form: 'tablet',
    dose_label: '1 tablet',
    frequency_code: 'BD',
    times_of_day: ['08:00', '20:00'],
    duration_days: 5,
    food_instruction: 'after_food',
    notes: 'Painkiller. Always take after food to protect the stomach.',
    color: 'rose',
    active: true,
    sort_order: 5,
  },
  {
    name: 'Vitamin C (Ascorbic Acid)',
    strength: '500 mg',
    form: 'chewable tablet',
    dose_label: '1 tablet',
    frequency_code: 'OD',
    times_of_day: ['08:00'],
    duration_days: 14,
    food_instruction: 'after_food',
    notes: 'Limcee. Chewable — 2 week course.',
    color: 'orange',
    active: true,
    sort_order: 6,
  },
  {
    name: 'Mupirocin Ointment',
    strength: '2%',
    form: 'ointment',
    dose_label: 'Apply locally',
    frequency_code: 'TDS',
    times_of_day: ['08:00', '14:00', '20:00'],
    duration_days: 7,
    food_instruction: 'any',
    notes: 'For local application only. Wash hands before and after applying.',
    color: 'teal',
    active: true,
    sort_order: 7,
  },
];

/** Prescription start date — the date the script was issued. */
export const PRESCRIPTION_START_DATE = '2026-07-27';

/**
 * Seeded once per user into `med_appointments`. Kept module-private and
 * deliberately neutral: no institution, clinician, department or specimen
 * names. This module is imported by the /meds client component, so anything
 * in here is only kept out of the public bundle by tree-shaking — the wording
 * must stay safe even if that guarantee is lost.
 */
const DEFAULT_APPOINTMENTS: AppointmentInput[] = [
  {
    label: 'Follow-up: bring lab results',
    date: '2026-07-30',
    detail: 'Bring the lab report to this appointment.',
  },
  {
    label: 'Follow-up review appointment',
    date: '2026-08-03',
    detail: 'Routine review one week on.',
  },
];

// ---------------------------------------------------------------- schema

export async function initMedsSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS medications (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      strength TEXT,
      form TEXT NOT NULL DEFAULT 'tablet',
      dose_label TEXT NOT NULL DEFAULT '1 tablet',
      frequency_code TEXT NOT NULL DEFAULT 'OD',
      times_of_day TEXT NOT NULL DEFAULT '["08:00"]',
      start_date DATE NOT NULL DEFAULT CURRENT_DATE,
      duration_days INTEGER,
      food_instruction TEXT NOT NULL DEFAULT 'any',
      notes TEXT,
      color TEXT NOT NULL DEFAULT 'violet',
      active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_medications_user ON medications(user_id)`;
  // Added after the table shipped. Nullable on purpose: null means "derive the
  // gap from this medicine's own times", so existing rows keep working untouched.
  await sql`ALTER TABLE medications ADD COLUMN IF NOT EXISTS min_gap_minutes INTEGER`;

  await sql`
    CREATE TABLE IF NOT EXISTS medication_doses (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scheduled_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      taken_at TIMESTAMPTZ,
      snoozed_until TIMESTAMPTZ,
      notified_count INTEGER NOT NULL DEFAULT 0,
      last_notified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (medication_id, scheduled_at)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_doses_user_time ON medication_doses(user_id, scheduled_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS med_settings (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      tz_offset_minutes INTEGER NOT NULL DEFAULT 300,
      alarm_enabled BOOLEAN NOT NULL DEFAULT true,
      alarm_sound TEXT NOT NULL DEFAULT 'siren',
      alarm_volume REAL NOT NULL DEFAULT 1.0,
      repeat_interval_min INTEGER NOT NULL DEFAULT 5,
      max_repeats INTEGER NOT NULL DEFAULT 12,
      snooze_min INTEGER NOT NULL DEFAULT 10,
      -- Retained, unread and unwritten, only to avoid a destructive migration:
      -- quiet hours were removed (a medicine reminder must always be audible).
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS med_appointments (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      date DATE NOT NULL,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_med_appointments_user ON med_appointments(user_id)`;

  // NOTE: `endpoint` deliberately has no inline UNIQUE. A push endpoint belongs
  // to a browser registration, not to a person, so a global unique on it let a
  // second account signing in from the same browser profile steal the row and
  // silently leave the first account with no subscriptions — and no reminders.
  // Uniqueness is on (user_id, endpoint) instead; see the index below.
  await sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)`;

  // Order matters, and this whole block must stay idempotent — initMedsSchema
  // runs on every app boot. Create the replacement BEFORE dropping the old
  // endpoint-only constraint so the table is never briefly unconstrained. The
  // old constraint also guarantees the new index cannot fail on duplicates:
  // unique(endpoint) implies unique(user_id, endpoint).
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_push_user_endpoint
      ON push_subscriptions(user_id, endpoint)
  `;
  // Databases created before this change carry the inline constraint under its
  // default name. Nothing to do on a fresh database.
  await sql`
    ALTER TABLE push_subscriptions
      DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key
  `;
}

// ---------------------------------------------------------------- time helpers

/** Current wall-clock date/time in the user's timezone. */
export function tzNow(offsetMin: number): { date: string; minutes: number } {
  const shifted = new Date(Date.now() + offsetMin * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Convert a local (tz) date + HH:MM into the true UTC instant. */
export function scheduledAtUTC(dateStr: string, hhmm: string, offsetMin: number): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0, 0) - offsetMin * 60_000);
}

export function addDays(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Is this medicine's course running on the given local date? */
export function isActiveOn(med: Medication, dateStr: string): boolean {
  if (!med.active) return false;
  const elapsed = daysBetween(med.start_date, dateStr);
  if (elapsed < 0) return false;
  if (med.duration_days == null) return true;
  return elapsed < med.duration_days;
}

/**
 * Last local date the course is still active (inclusive — a 7 day course that
 * starts on the 27th ends on the 2nd, and the 2nd still has doses), or null
 * when the medicine is ongoing.
 */
export function courseEndDate(med: Medication): string | null {
  return med.duration_days == null ? null : addDays(med.start_date, med.duration_days - 1);
}

// ---------------------------------------------------------------- mapping

function parseTimes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalise a DATE column into a "YYYY-MM-DD" string.
 *
 * Every date query in this module casts DATE columns with `::text`, so the
 * common path here is already a string. This is the belt-and-braces layer for a
 * query that forgets the cast: @vercel/postgres talks to Neon through
 * @neondatabase/serverless, which registers pg-types' parser for OID 1082, and
 * that parser returns a JS Date. `String(date).slice(0, 10)` on one of those
 * yields "Mon Jul 27" — which turns every downstream date calculation into NaN.
 *
 * The components are read in LOCAL time on purpose. pg-types builds a DATE with
 * `new Date(year, month, day)`, i.e. *local* midnight, so a DATE of 2026-07-27
 * read on a machine set to Maldives time (the user's own timezone, UTC+5) is
 * the instant 2026-07-26T19:00Z. Reading UTC components there would report the
 * 26th and shift the entire course a day early — including the last day of an
 * antibiotic run. Local components round-trip the stored date in every
 * timezone. A Date built as UTC midnight instead has zeroed UTC components, so
 * it is detected and read the other way round.
 */
function toISODate(v: unknown): string {
  let out: string;

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) {
      throw new Error('toISODate: received an Invalid Date');
    }
    const isLocalMidnight =
      v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0 && v.getMilliseconds() === 0;
    const y = isLocalMidnight ? v.getFullYear() : v.getUTCFullYear();
    const mo = (isLocalMidnight ? v.getMonth() : v.getUTCMonth()) + 1;
    const d = isLocalMidnight ? v.getDate() : v.getUTCDate();
    out = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  } else {
    out = String(v ?? '').slice(0, 10);
  }

  // Returning anything else would silently poison daysBetween/isActiveOn and
  // quietly stop the reminders, which is far worse than a loud failure.
  if (!ISO_DATE_RE.test(out)) {
    throw new Error(`toISODate: expected a YYYY-MM-DD date, got ${JSON.stringify(v)}`);
  }
  return out;
}

/**
 * TIMESTAMPTZ columns come back as Date objects too. `String(date)` on one of
 * those gives "Mon Jul 27 2026 ..." rather than the ISO string these fields are
 * typed and consumed as, so normalise here.
 */
function toISOTimestamp(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v ?? '');
}

function mapMedication(row: Record<string, unknown>): Medication {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name),
    strength: row.strength ? String(row.strength) : null,
    form: String(row.form),
    dose_label: String(row.dose_label),
    frequency_code: String(row.frequency_code) as FrequencyCode,
    times_of_day: parseTimes(row.times_of_day).slice().sort(),
    start_date: toISODate(row.start_date),
    duration_days: row.duration_days != null ? Number(row.duration_days) : null,
    min_gap_minutes: row.min_gap_minutes != null ? Number(row.min_gap_minutes) : null,
    food_instruction: String(row.food_instruction) as FoodInstruction,
    notes: row.notes ? String(row.notes) : null,
    color: String(row.color),
    active: Boolean(row.active),
    sort_order: Number(row.sort_order ?? 0),
    created_at: toISOTimestamp(row.created_at),
    updated_at: toISOTimestamp(row.updated_at),
  };
}

function mapSettings(row: Record<string, unknown>): MedSettings {
  return {
    user_id: String(row.user_id),
    tz_offset_minutes: Number(row.tz_offset_minutes ?? MALDIVES_OFFSET_MIN),
    alarm_enabled: Boolean(row.alarm_enabled),
    alarm_sound: String(row.alarm_sound ?? 'siren'),
    alarm_volume: Number(row.alarm_volume ?? 1),
    repeat_interval_min: Number(row.repeat_interval_min ?? 5),
    max_repeats: Number(row.max_repeats ?? 12),
    snooze_min: Number(row.snooze_min ?? 10),
    // quiet_hours_start / quiet_hours_end are intentionally not mapped: the
    // columns may still hold values from before the feature was removed, and
    // nothing may read them back into a reminder decision.
    updated_at: toISOTimestamp(row.updated_at),
  };
}

function mapAppointment(row: Record<string, unknown>): Appointment {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    label: String(row.label),
    date: toISODate(row.date),
    detail: row.detail ? String(row.detail) : null,
    created_at: toISOTimestamp(row.created_at),
  };
}

// ---------------------------------------------------------------- settings

export async function getSettings(userId: string): Promise<MedSettings> {
  const existing = await sql`SELECT * FROM med_settings WHERE user_id = ${userId} LIMIT 1`;
  if (existing.rows.length > 0) return mapSettings(existing.rows[0]);
  const created = await sql`
    INSERT INTO med_settings (user_id) VALUES (${userId})
    ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
    RETURNING *
  `;
  return mapSettings(created.rows[0]);
}

/**
 * The only columns a settings PATCH may touch. quiet_hours_start /
 * quiet_hours_end are deliberately absent — the columns still exist, but no
 * request can put a value back into them.
 */
const SETTINGS_FIELDS = [
  'tz_offset_minutes', 'alarm_enabled', 'alarm_sound', 'alarm_volume',
  'repeat_interval_min', 'max_repeats', 'snooze_min',
] as const;

export async function updateSettings(userId: string, patch: Partial<MedSettings>): Promise<MedSettings> {
  await getSettings(userId); // ensure the row exists
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const key of SETTINGS_FIELDS) {
    if (key in patch) {
      fields.push(`${key} = $${idx}`);
      values.push(patch[key] ?? null);
      idx++;
    }
  }
  if (fields.length === 0) return getSettings(userId);
  fields.push('updated_at = NOW()');
  values.push(userId);
  const result = await sql.query(
    `UPDATE med_settings SET ${fields.join(', ')} WHERE user_id = $${idx} RETURNING *`,
    values
  );
  return mapSettings(result.rows[0]);
}

// ---------------------------------------------------------------- medications CRUD

/**
 * The column list for EVERY medications read — single source of truth so a new
 * query cannot quietly reintroduce the DATE bug.
 *
 * `start_date::text` is load-bearing: without it the driver hands back a JS Date
 * (see toISODate) and isActiveOn() goes false for every medicine that has a
 * duration, which is all seven prescription defaults. Casting in SQL means the
 * driver never gets the chance to convert. An explicit list is used rather than
 * `SELECT *, start_date::text AS start_date`, because that returns two columns
 * of the same name and which one wins is not something to leave to chance.
 */
const MED_COLUMNS = `
  id, user_id, name, strength, form, dose_label, frequency_code, times_of_day,
  start_date::text AS start_date, duration_days, min_gap_minutes, food_instruction,
  notes, color, active, sort_order, created_at, updated_at
`;

export async function getMedications(userId: string): Promise<Medication[]> {
  const result = await sql.query(
    `SELECT ${MED_COLUMNS} FROM medications WHERE user_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [userId]
  );
  return result.rows.map(mapMedication);
}

export async function createMedication(userId: string, input: MedicationInput): Promise<Medication> {
  const result = await sql.query(
    `INSERT INTO medications (
       user_id, name, strength, form, dose_label, frequency_code, times_of_day,
       start_date, duration_days, min_gap_minutes, food_instruction, notes, color,
       active, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING ${MED_COLUMNS}`,
    [
      userId, input.name, input.strength ?? null, input.form, input.dose_label,
      input.frequency_code, JSON.stringify(input.times_of_day), input.start_date,
      input.duration_days ?? null, input.min_gap_minutes ?? null, input.food_instruction,
      input.notes ?? null, input.color, input.active, input.sort_order,
    ]
  );
  return mapMedication(result.rows[0]);
}

const MED_FIELDS = [
  'name', 'strength', 'form', 'dose_label', 'frequency_code', 'times_of_day',
  'start_date', 'duration_days', 'min_gap_minutes', 'food_instruction', 'notes', 'color',
  'active', 'sort_order',
] as const;

export async function updateMedication(
  id: string,
  userId: string,
  patch: Partial<MedicationInput>
): Promise<Medication> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const key of MED_FIELDS) {
    if (key in patch) {
      fields.push(`${key} = $${idx}`);
      values.push(key === 'times_of_day' ? JSON.stringify(patch.times_of_day ?? []) : patch[key] ?? null);
      idx++;
    }
  }
  if (fields.length === 0) {
    const current = await sql.query(
      `SELECT ${MED_COLUMNS} FROM medications WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (current.rows.length === 0) throw new Error('Medicine not found');
    return mapMedication(current.rows[0]);
  }
  fields.push('updated_at = NOW()');
  values.push(id, userId);
  const result = await sql.query(
    `UPDATE medications SET ${fields.join(', ')}
     WHERE id = $${idx} AND user_id = $${idx + 1}
     RETURNING ${MED_COLUMNS}`,
    values
  );
  if (result.rows.length === 0) throw new Error('Medicine not found');
  return mapMedication(result.rows[0]);
}

export async function deleteMedication(id: string, userId: string): Promise<void> {
  await sql`DELETE FROM medications WHERE id = ${id} AND user_id = ${userId}`;
}

/** Loads the prescription defaults. Replaces everything when `replace` is set. */
export async function seedPrescriptionDefaults(userId: string, replace = false): Promise<Medication[]> {
  // Appointments are seeded independently of the medicines: this is idempotent
  // on its own, and `replace` is about the regimen, not her calendar.
  await seedDefaultAppointments(userId);

  if (replace) {
    await sql`DELETE FROM medications WHERE user_id = ${userId}`;
  } else {
    const existing = await sql`SELECT id FROM medications WHERE user_id = ${userId} LIMIT 1`;
    if (existing.rows.length > 0) return getMedications(userId);
  }
  for (const def of PRESCRIPTION_DEFAULTS) {
    await createMedication(userId, { ...def, start_date: PRESCRIPTION_START_DATE });
  }
  return getMedications(userId);
}

// ---------------------------------------------------------------- appointments

/** Same `::text` cast rule as the medications columns — see MED_COLUMNS. */
const APPOINTMENT_COLUMNS = `id, user_id, label, date::text AS date, detail, created_at`;

export async function getAppointments(userId: string): Promise<Appointment[]> {
  const result = await sql.query(
    `SELECT ${APPOINTMENT_COLUMNS} FROM med_appointments
     WHERE user_id = $1 ORDER BY date ASC, created_at ASC`,
    [userId]
  );
  return result.rows.map(mapAppointment);
}

export async function createAppointment(
  userId: string,
  input: AppointmentInput
): Promise<Appointment> {
  const result = await sql.query(
    `INSERT INTO med_appointments (user_id, label, date, detail)
     VALUES ($1, $2, $3, $4)
     RETURNING ${APPOINTMENT_COLUMNS}`,
    [userId, input.label, input.date, input.detail ?? null]
  );
  return mapAppointment(result.rows[0]);
}

export async function deleteAppointment(id: string, userId: string): Promise<void> {
  await sql`DELETE FROM med_appointments WHERE id = ${id} AND user_id = ${userId}`;
}

/** Adds the default follow-ups, but only for a user who has no appointments yet. */
export async function seedDefaultAppointments(userId: string): Promise<void> {
  const existing = await sql`SELECT id FROM med_appointments WHERE user_id = ${userId} LIMIT 1`;
  if (existing.rows.length > 0) return;
  for (const appointment of DEFAULT_APPOINTMENTS) {
    await createAppointment(userId, appointment);
  }
}

// ---------------------------------------------------------------- schedule

/** Expand medication definitions into the expected doses for one local date. */
export function computeDosesForDate(
  meds: Medication[],
  dateStr: string,
  offsetMin: number
): PlannedDose[] {
  const out: PlannedDose[] = [];
  for (const med of meds) {
    if (!isActiveOn(med, dateStr)) continue;
    for (const time of med.times_of_day) {
      const at = scheduledAtUTC(dateStr, time, offsetMin);
      out.push({
        key: `${med.id}|${at.toISOString()}`,
        medication_id: med.id,
        name: med.name,
        strength: med.strength,
        form: med.form,
        dose_label: med.dose_label,
        food_instruction: med.food_instruction,
        notes: med.notes,
        color: med.color,
        time,
        scheduled_at: at.toISOString(),
      });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
}

// ------------------------------------------------------- minimum dose spacing

/** Smallest gap between consecutive configured times, wrapping past midnight. */
export function tightestIntervalMinutes(times: string[]): number {
  const mins = times
    .map(t => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    })
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (mins.length < 2) return 24 * 60;
  let smallest = Infinity;
  for (let i = 0; i < mins.length; i++) {
    const next = i + 1 < mins.length ? mins[i + 1] : mins[0] + 1440;
    smallest = Math.min(smallest, next - mins[i]);
  }
  return smallest === Infinity ? 24 * 60 : smallest;
}

/**
 * The gap to enforce when no explicit one is set: three quarters of the
 * tightest interval the medicine is actually scheduled at.
 *
 * Not the full interval, deliberately. Enforcing the whole 6h after a dose
 * taken 2h late would push every later dose back by 2h too and quietly cost her
 * the day's third dose — for an antibiotic, completing the day's doses matters
 * as much as spacing them. Three quarters stops doses stacking dangerously
 * close while still leaving room to catch up.
 *
 * TDS 08:00/14:00/20:00 -> tightest 6h -> 4h30. BD 08:00/20:00 -> 9h. OD -> 18h.
 */
export function defaultMinGapMinutes(times: string[]): number {
  const tightest = tightestIntervalMinutes(times);
  return Math.max(30, Math.round((tightest * 0.75) / 15) * 15);
}

export function effectiveMinGapMinutes(med: Medication): number {
  return med.min_gap_minutes ?? defaultMinGapMinutes(med.times_of_day);
}

export interface DoseTiming {
  effective_at: string;
  deferred_by_minutes: number;
  defer_after_taken_at: string | null;
}

/**
 * A dose as the schedule alone describes it — before anything is known about
 * whether it was taken, or about when the dose before it actually was.
 */
export type PlannedDose = Omit<
  ScheduledDose,
  'status' | 'taken_at' | 'snoozed_until' | 'effective_at' | 'deferred_by_minutes' | 'defer_after_taken_at'
>;

/**
 * Work out when each dose should actually be reminded about, given when the
 * previous dose of the same medicine was really swallowed.
 *
 * Only the IMMEDIATELY preceding dose is consulted, so a deferral cannot
 * cascade: if that dose was also late, it has already been shifted relative to
 * ITS predecessor, and each dose is measured against the tablet actually taken
 * before it rather than against a growing chain of estimates.
 *
 * `doses` must include the day BEFORE the one being rendered, or the first dose
 * of the day has no predecessor to measure against — an overnight-late dose is
 * exactly the case this exists for.
 *
 * Pure: no clock, no database. That is what makes it testable.
 */
export function computeDoseTimings(
  doses: PlannedDose[],
  medsById: Map<string, Medication>,
  takenAtByKey: Map<string, string>
): Map<string, DoseTiming> {
  const byMed = new Map<string, PlannedDose[]>();
  for (const d of doses) {
    const list = byMed.get(d.medication_id);
    if (list) list.push(d);
    else byMed.set(d.medication_id, [d]);
  }

  const out = new Map<string, DoseTiming>();
  for (const [medId, list] of byMed) {
    const med = medsById.get(medId);
    const gapMs = med ? effectiveMinGapMinutes(med) * 60_000 : 0;
    const ordered = [...list].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

    for (let i = 0; i < ordered.length; i++) {
      const dose = ordered[i];
      const scheduledMs = new Date(dose.scheduled_at).getTime();
      let effectiveMs = scheduledMs;
      let after: string | null = null;

      const prev = i > 0 ? ordered[i - 1] : null;
      const prevTaken = prev ? takenAtByKey.get(prev.key) : undefined;
      if (prevTaken && gapMs > 0) {
        const earliest = new Date(prevTaken).getTime() + gapMs;
        // Only ever pushes later. Taking a dose EARLY must not drag the next
        // one forward into a gap she never agreed to.
        if (earliest > effectiveMs) {
          effectiveMs = earliest;
          after = new Date(prevTaken).toISOString();
        }
      }

      out.set(dose.key, {
        effective_at: new Date(effectiveMs).toISOString(),
        deferred_by_minutes: Math.round((effectiveMs - scheduledMs) / 60_000),
        defer_after_taken_at: after,
      });
    }
  }
  return out;
}

/** Full day view: expected doses joined with whatever was logged against them. */
export async function getDayView(
  userId: string,
  dateStr: string
): Promise<{ date: string; settings: MedSettings; doses: ScheduledDose[]; medications: Medication[] }> {
  const [settings, medications] = await Promise.all([getSettings(userId), getMedications(userId)]);
  const expected = computeDosesForDate(medications, dateStr, settings.tz_offset_minutes);

  // The previous day is computed too, purely so the first dose of `dateStr` has
  // a predecessor to measure its minimum gap against. Those doses are used for
  // timing and then dropped — only `dateStr` is returned.
  const prior = computeDosesForDate(
    medications,
    addDays(dateStr, -1),
    settings.tz_offset_minutes
  );

  const dayStart = scheduledAtUTC(dateStr, '00:00', settings.tz_offset_minutes);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  // Widened to cover the lookback day as well, so a late dose last night can
  // still defer this morning's.
  const lookbackStart = new Date(dayStart.getTime() - 86_400_000);
  const logged = await sql`
    SELECT medication_id, scheduled_at, status, taken_at, snoozed_until
    FROM medication_doses
    WHERE user_id = ${userId}
      AND scheduled_at >= ${lookbackStart.toISOString()}
      AND scheduled_at < ${dayEnd.toISOString()}
  `;
  const logMap = new Map<string, Record<string, unknown>>();
  const takenAtByKey = new Map<string, string>();
  for (const row of logged.rows) {
    const key = `${String(row.medication_id)}|${new Date(String(row.scheduled_at)).toISOString()}`;
    logMap.set(key, row);
    if (String(row.status) === 'taken' && row.taken_at) {
      takenAtByKey.set(key, toISOTimestamp(row.taken_at));
    }
  }

  const medsById = new Map(medications.map(m => [m.id, m]));
  const timings = computeDoseTimings([...prior, ...expected], medsById, takenAtByKey);

  const doses: ScheduledDose[] = expected.map(d => {
    const log = logMap.get(d.key);
    const timing = timings.get(d.key);
    return {
      ...d,
      status: (log ? String(log.status) : 'pending') as DoseStatus,
      taken_at: log?.taken_at ? toISOTimestamp(log.taken_at) : null,
      snoozed_until: log?.snoozed_until ? toISOTimestamp(log.snoozed_until) : null,
      effective_at: timing?.effective_at ?? d.scheduled_at,
      deferred_by_minutes: timing?.deferred_by_minutes ?? 0,
      defer_after_taken_at: timing?.defer_after_taken_at ?? null,
    };
  });

  return { date: dateStr, settings, doses, medications };
}

// ---------------------------------------------------------------- dose logging

/**
 * A dose is "settled" once it has been taken or skipped — the two statuses a
 * guarded write refuses to overwrite, and the two that stop the dispatcher
 * reminding.
 *
 * Kept in step by hand with the literal list in logDose's ON CONFLICT ... WHERE
 * below, which cannot be parameterised: the driver only interpolates primitives,
 * and spelling the statuses out is what makes that guard auditable at a glance.
 * Change one, change the other.
 */
const SETTLED_STATUSES: readonly DoseStatus[] = ['taken', 'skipped'];

export function isSettledStatus(status: string): boolean {
  return (SETTLED_STATUSES as readonly string[]).includes(status);
}

export interface LogDoseResult {
  /**
   * Whether the caller's request was honoured. False *only* under
   * `guardSettled`, when the dose was already settled as something else and
   * nothing was written — the caller should answer 409.
   */
  applied: boolean;
  /**
   * The dose's status now: the one just written, or — on a refusal — the
   * settled status that blocked the write, so the caller can name it.
   */
  status: DoseStatus;
}

/**
 * Record an action against a dose.
 *
 * `guardSettled` makes the write refuse to move a dose OUT of a settled status
 * ('taken' or 'skipped'). It exists because reading the status and then writing
 * it are two round trips: a service-worker snooze and an in-app tick ~100ms
 * apart can both read 'pending', and whichever lands last wins — which is how a
 * stale lock-screen notification could flip a dose she has already swallowed
 * back to pending and re-alarm her for it. The guard is therefore part of the
 * UPDATE itself, evaluated by Postgres against the row it is about to write, so
 * there is no window between the check and the write.
 *
 * Explicit in-app actions pass force (guardSettled = false) and are never
 * blocked: undoing a mis-tap has to keep working.
 */
export async function logDose(
  userId: string,
  medicationId: string,
  scheduledAt: string,
  status: DoseStatus,
  snoozeMinutes?: number,
  guardSettled = false,
  takenAtISO?: string
): Promise<LogDoseResult> {
  const at = new Date(scheduledAt).toISOString();
  // She confirms when she actually swallowed it, which is not always now — and
  // the next dose's minimum gap is measured from this value, so "now" would
  // quietly overstate the spacing every time she ticks a dose off late.
  const takenAt =
    status === 'taken' ? new Date(takenAtISO ?? Date.now()).toISOString() : null;
  const snoozedUntil = snoozeMinutes
    ? new Date(Date.now() + snoozeMinutes * 60_000).toISOString()
    : null;

  // A snooze restarts the reminder budget. Without this reset the repeats are
  // still counted against the ORIGINAL dose time, and since the budget is spent
  // ~55 minutes in (12 repeats x 5 min), every later snooze was a silent no-op:
  // the UI promised "Reminding you again in 120 minutes" and the dispatcher then
  // never pushed again. `EXCLUDED.snoozed_until IS NOT NULL` is precisely "this
  // write is a snooze", so non-snooze writes leave the counters untouched.
  //
  // The guard rides on the DO UPDATE's WHERE. Postgres takes a lock on the
  // conflicting row and re-evaluates that WHERE against the row as it stands
  // *after* any concurrent write commits, which is what closes the race: a
  // snooze that read 'pending' a moment ago still sees 'taken' here and refuses.
  // A refused statement updates nothing and RETURNING yields no row.
  const written = await sql`
    INSERT INTO medication_doses (
      medication_id, user_id, scheduled_at, status, taken_at, snoozed_until,
      notified_count, last_notified_at
    )
    VALUES (
      ${medicationId}, ${userId}, ${at}, ${status}, ${takenAt}, ${snoozedUntil},
      0, NULL
    )
    ON CONFLICT (medication_id, scheduled_at) DO UPDATE
      SET status = EXCLUDED.status,
          taken_at = EXCLUDED.taken_at,
          snoozed_until = EXCLUDED.snoozed_until,
          notified_count = CASE WHEN EXCLUDED.snoozed_until IS NOT NULL
                                THEN 0 ELSE medication_doses.notified_count END,
          last_notified_at = CASE WHEN EXCLUDED.snoozed_until IS NOT NULL
                                  THEN NULL ELSE medication_doses.last_notified_at END,
          updated_at = NOW()
      WHERE NOT ${guardSettled}::boolean
         OR medication_doses.status NOT IN ('taken', 'skipped')
    RETURNING status
  `;
  if (written.rows.length > 0) {
    return { applied: true, status: String(written.rows[0].status) as DoseStatus };
  }

  // Only a guarded write can land here, and only against an already-settled row.
  // Read it back rather than assuming: this has to run AFTER the statement above
  // so it observes whatever concurrent write actually won, not the snapshot this
  // request started from.
  const current = await sql`
    SELECT status FROM medication_doses
    WHERE medication_id = ${medicationId} AND scheduled_at = ${at}
    LIMIT 1
  `;
  if (current.rows.length === 0) return { applied: false, status };
  const settled = String(current.rows[0].status) as DoseStatus;

  // Re-asserting the status a dose already has changed nothing, so it is a
  // success rather than a 409 — and because the write was skipped, the original
  // taken_at survives instead of being bumped to now.
  return { applied: settled === status, status: settled };
}

/** Adherence over the last N days: how many expected doses were actually ticked. */
export async function getAdherence(
  userId: string,
  days = 7
): Promise<{ expected: number; taken: number; skipped: number; percent: number }> {
  const settings = await getSettings(userId);
  const medications = await getMedications(userId);
  const { date: today } = tzNow(settings.tz_offset_minutes);

  let expected = 0;
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    for (const dose of computeDosesForDate(medications, d, settings.tz_offset_minutes)) {
      // only count doses whose time has already passed
      if (new Date(dose.scheduled_at).getTime() <= Date.now()) {
        expected++;
        keys.push(dose.key);
      }
    }
  }
  if (expected === 0) return { expected: 0, taken: 0, skipped: 0, percent: 100 };

  const windowStart = scheduledAtUTC(addDays(today, -(days - 1)), '00:00', settings.tz_offset_minutes);
  const logged = await sql`
    SELECT medication_id, scheduled_at, status FROM medication_doses
    WHERE user_id = ${userId} AND scheduled_at >= ${windowStart.toISOString()}
  `;
  const keySet = new Set(keys);
  let taken = 0;
  let skipped = 0;
  for (const row of logged.rows) {
    const key = `${String(row.medication_id)}|${new Date(String(row.scheduled_at)).toISOString()}`;
    if (!keySet.has(key)) continue;
    if (String(row.status) === 'taken') taken++;
    else if (String(row.status) === 'skipped') skipped++;
  }
  return { expected, taken, skipped, percent: Math.round((taken / expected) * 100) };
}

// ---------------------------------------------------------------- push subscriptions

export interface StoredSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function savePushSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
  userAgent?: string
): Promise<void> {
  // Conflict target is (user_id, endpoint): re-subscribing refreshes this user's
  // own row and never touches a row belonging to somebody else who happens to
  // share the browser profile.
  await sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (${userId}, ${endpoint}, ${p256dh}, ${auth}, ${userAgent ?? null})
    ON CONFLICT (user_id, endpoint) DO UPDATE
      SET p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          user_agent = EXCLUDED.user_agent
  `;
}

/**
 * Scoped by user: unsubscribing one account must not delete another's row.
 *
 * Argument order is (resource, userId) to match deleteMedication and
 * deleteAppointment. Both parameters are strings, so swapping them type-checks
 * cleanly and then silently deletes nothing — keep this order.
 */
export async function deletePushSubscription(endpoint: string, userId: string): Promise<void> {
  await sql`
    DELETE FROM push_subscriptions
    WHERE endpoint = ${endpoint} AND user_id = ${userId}
  `;
}

export async function getPushSubscriptions(userId: string): Promise<StoredSubscription[]> {
  const result = await sql`SELECT * FROM push_subscriptions WHERE user_id = ${userId}`;
  return result.rows.map(r => ({
    id: String(r.id),
    user_id: String(r.user_id),
    endpoint: String(r.endpoint),
    p256dh: String(r.p256dh),
    auth: String(r.auth),
  }));
}

// ---------------------------------------------------------------- dispatch

/**
 * How long a dose stays eligible for a reminder, measured from its *effective
 * wake time* (see below), when the caller does not say otherwise.
 *
 * This has to outlast the full nagging cycle plus one snooze, or a dose falls
 * out of the window mid-cycle and is never mentioned again. With the defaults
 * that is max_repeats * repeat_interval_min (12 * 5 = 60) + snooze_min (10) =
 * 70 minutes, so 240 leaves generous headroom.
 *
 * The settings API allows much larger values than the defaults, so
 * getDueDosesForDispatch does NOT trust this number alone — it widens the
 * window per user from that user's own settings. This constant is the floor.
 */
const DEFAULT_GRACE_MINUTES = 240;

/**
 * Every user with at least one push subscription, and their doses that are due
 * right now (or overdue) and not yet actioned. Used by the cron dispatcher.
 *
 * Eligibility is anchored on each dose's *effective wake time* —
 * max(scheduled_at, snoozed_until) — not on scheduled_at. Anchoring on
 * scheduled_at is what made snoozing lose doses outright: once snoozed_until
 * landed further out than the grace window, the dose was filtered away before
 * the snooze expired and was never notified again, while the UI still showed it
 * as pending. The log therefore has to be read BEFORE candidates are filtered,
 * because snoozed_until is an input to that filter.
 *
 * The window also looks backwards so a cron that only runs every few minutes
 * still catches a dose scheduled between ticks.
 */
export async function getDueDosesForDispatch(
  graceMinutes = DEFAULT_GRACE_MINUTES
): Promise<Map<string, DueDose[]>> {
  const subscribed = await sql`
    SELECT DISTINCT user_id FROM push_subscriptions
  `;
  const result = new Map<string, DueDose[]>();
  const now = Date.now();

  for (const row of subscribed.rows) {
    const userId = String(row.user_id);
    const settings = await getSettings(userId);
    if (!settings.alarm_enabled) continue;

    const { date: today } = tzNow(settings.tz_offset_minutes);
    const medications = await getMedications(userId);

    // Look at today and yesterday so a late-night dose still nags after midnight.
    const expected = [
      ...computeDosesForDate(medications, addDays(today, -1), settings.tz_offset_minutes),
      ...computeDosesForDate(medications, today, settings.tz_offset_minutes),
    ];
    if (expected.length === 0) continue;

    // Derived rather than hard-coded so the grace window and the nagging
    // settings can never drift apart: whatever repeat/snooze values are in
    // force, the window outlasts a complete cycle plus one full snooze.
    const effectiveGraceMin = Math.max(
      graceMinutes,
      settings.max_repeats * settings.repeat_interval_min + settings.snooze_min
    );

    // Read the log first — a snooze can push a dose's wake time well past its
    // scheduled time, so the candidate filter below needs snoozed_until. The
    // lookback covers both computed days in full regardless of tz offset.
    const logged = await sql`
      SELECT medication_id, scheduled_at, status, taken_at, snoozed_until, notified_count, last_notified_at
      FROM medication_doses
      WHERE user_id = ${userId}
        AND scheduled_at >= ${new Date(now - 72 * 60 * 60_000).toISOString()}
    `;
    const logMap = new Map<string, Record<string, unknown>>();
    const takenAtByKey = new Map<string, string>();
    for (const l of logged.rows) {
      const key = `${String(l.medication_id)}|${new Date(String(l.scheduled_at)).toISOString()}`;
      logMap.set(key, l);
      if (String(l.status) === 'taken' && l.taken_at) {
        takenAtByKey.set(key, toISOTimestamp(l.taken_at));
      }
    }

    // `expected` already spans yesterday and today, so every dose here has its
    // predecessor available to measure the minimum gap against.
    const medsById = new Map(medications.map(m => [m.id, m]));
    const timings = computeDoseTimings(expected, medsById, takenAtByKey);

    const due: DueDose[] = [];
    for (const c of expected) {
      const log = logMap.get(c.key);
      const status = log ? String(log.status) : 'pending';
      if (isSettledStatus(status)) continue;

      const scheduledMs = new Date(c.scheduled_at).getTime();
      const timing = timings.get(c.key);
      // A late previous dose pushes this one's reminder back, so she is never
      // told to take the next tablet too soon after the one she just swallowed.
      const effectiveMs = timing ? new Date(timing.effective_at).getTime() : scheduledMs;
      const snoozedUntilMs = log?.snoozed_until ? new Date(String(log.snoozed_until)).getTime() : 0;

      // When she snoozes, the dose is not due again until the snooze runs out.
      const effectiveWake = Math.max(effectiveMs, snoozedUntilMs || 0);
      if (now < effectiveWake) continue;
      if (now - effectiveWake > effectiveGraceMin * 60_000) continue;

      // stop nagging after max_repeats
      const notified = log ? Number(log.notified_count ?? 0) : 0;
      if (notified >= settings.max_repeats) continue;

      // honour the repeat interval
      const lastNotified = log?.last_notified_at ? new Date(String(log.last_notified_at)).getTime() : 0;
      if (lastNotified && now - lastNotified < settings.repeat_interval_min * 60_000) continue;

      due.push({
        ...c,
        status: 'pending',
        taken_at: null,
        snoozed_until: snoozedUntilMs ? new Date(snoozedUntilMs).toISOString() : null,
        effective_at: timing?.effective_at ?? c.scheduled_at,
        deferred_by_minutes: timing?.deferred_by_minutes ?? 0,
        defer_after_taken_at: timing?.defer_after_taken_at ?? null,
        user_id: userId,
        // Measured from the EFFECTIVE time, not the scheduled one: once a dose
        // has been deliberately pushed back it is not late until the new time
        // passes, and calling it "2h overdue" the moment it is deferred would
        // be both wrong and alarming.
        overdue_minutes: Math.round((now - effectiveMs) / 60_000),
      });
    }
    if (due.length > 0) result.set(userId, due);
  }
  return result;
}

/** Records that a reminder was actually delivered, so repeats back off correctly. */
export async function markNotified(userId: string, medicationId: string, scheduledAt: string): Promise<void> {
  const at = new Date(scheduledAt).toISOString();
  await sql`
    INSERT INTO medication_doses (medication_id, user_id, scheduled_at, status, notified_count, last_notified_at)
    VALUES (${medicationId}, ${userId}, ${at}, 'pending', 1, NOW())
    ON CONFLICT (medication_id, scheduled_at) DO UPDATE
      SET notified_count = medication_doses.notified_count + 1,
          last_notified_at = NOW(),
          updated_at = NOW()
  `;
}
