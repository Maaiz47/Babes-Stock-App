# Medicine reminders — setup

The Medicines section is a private reminder checklist with alarms. This guide covers everything
needed to make reminders actually fire, including when the app is closed and the phone is locked.

> **This is a reminder aid, not medical advice.** It does not replace the prescription or the
> instructions given by a doctor or pharmacist. If the app and the prescription ever disagree,
> the prescription is right.

---

## 1. Who can see it

Access is limited to the usernames listed in `src/lib/meds-access.ts`, plus any admin account:

```ts
export const MEDS_USERNAMES = ['amanii'];
```

To give another account access, add its username to that array (usernames are stored lowercase)
and redeploy. Everyone else never sees the pill icon, and every `/api/meds/*` endpoint returns
403 for them.

---

## 2. Environment variables (Vercel)

**Project Settings → Environment Variables.** Add all three, to Production (and Preview if you
test there):

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Public half of the Web Push signing key. Safe to expose — it ships in the browser bundle by design. |
| `VAPID_PRIVATE_KEY` | Private half. **Secret.** Server-side only. |
| `CRON_SECRET` | Shared password that lets the scheduler call the dispatcher. **Secret.** |

### Generating the values

VAPID key pair — run once, locally:

```bash
npx web-push generate-vapid-keys
```

Cron secret — any long random string:

```bash
openssl rand -hex 32
```

Two things that will bite you if missed:

- **`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is read at build time**, not runtime. It gets inlined into the
  client bundle, so after adding or changing it you must **redeploy** — restarting is not enough.
- **Never commit `VAPID_PRIVATE_KEY` or `CRON_SECRET`.** They belong in Vercel's env settings and
  GitHub's Actions secrets, nowhere else. If either ever lands in a commit, rotate it rather than
  just deleting the line — git history keeps it.

If the VAPID variables are absent the app still works: the in-app alarm rings normally, and the
push layer quietly no-ops. Only the "phone is locked" path needs them.

---

## 3. The scheduler (free)

Reminders that arrive while the app is closed need something to poke the server on a schedule.
`.github/workflows/med-reminders.yml` does this with GitHub Actions, which is free.

**GitHub → Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `APP_URL` | Full production origin, no trailing slash — e.g. `https://your-app.vercel.app` |
| `CRON_SECRET` | Exactly the same value you put in Vercel |

### An honest caveat about timing

GitHub's scheduled workflows are **best-effort**. They are regularly a few minutes late and under
platform load can slip 10–20 minutes. The dispatcher compensates by looking backwards over a grace
window, so a late run still finds and sends the dose — but the notification can land noticeably
after the scheduled time.

If that drift matters, [cron-job.org](https://cron-job.org) is free, offers 1-minute granularity
and is far more punctual. Point it at:

```
POST https://your-app.vercel.app/api/meds/dispatch
Header: Authorization: Bearer <your CRON_SECRET>
```

then disable the GitHub workflow. Nothing in the app changes.

---

## 4. Setting up the iPhone

**These steps are required.** Skipping any of them means no sound and no notifications.

1. Open the site in **Safari**. It must be Safari — iOS only allows Safari to install a web app.
2. **Share → Add to Home Screen.**
3. Open the app **from the new home-screen icon**, not from a Safari tab.
4. Go to **Medicines** and tap **"Turn on alarms for this device"**, then **Allow** notifications.

Why step 3 and 4 are not optional:

- iOS only delivers web push to an **installed** web app, on **iOS 16.4 or newer**. A normal Safari
  tab will never receive them.
- iOS refuses to play audio until the user has interacted with the page at least once. That button
  is what unlocks the alarm sound — until it is tapped, alarms are silent.

Then check:

- **Settings → Notifications → Babes Stock** — allow, and turn on Sounds.
- The phone is not in **Silent**, **Focus** or **Do Not Disturb** mode. A web-push notification
  cannot override these the way a native alarm app can. For a genuinely critical dose, an iOS Clock
  alarm as a backup is worth considering.

### Testing it end to end

1. **Medicines → Settings → Test alarm** — checks the sound and volume in the app.
2. **Medicines → Settings → Send test notification** — checks the push path to the device.
3. GitHub → Actions → *Medicine reminders* → **Run workflow** — checks the scheduler, the secret
   and the dispatcher together. The run log prints the dispatcher's JSON response.

---

## 5. Defaults, and changing them

The schedule is preloaded on first visit from the prescription dated 27 July 2026. Times were
chosen around each drug's food requirements rather than spread evenly — the stomach-protection and
empty-stomach medicines are deliberately offset from the after-food ones.

Everything is editable in **Medicines → Medicines**: name, strength, dose, frequency, individual
times, start date, course length, food instruction and colour. **Reset to prescription defaults**
restores the original set.

All times are **Maldives time (UTC+5)**. To change the timezone: **Medicines → Settings → timezone
offset**.

Alarm behaviour is configurable in the same place — sound, volume, how often a missed dose repeats,
how many times it repeats before giving up, snooze length, and quiet hours. Quiet hours silence the
**sound** only; a dose still shows as overdue and still notifies.

---

## 6. Privacy

Only the medication regimen is stored in the repository. No patient name, hospital number, address,
diagnosis, clinician name or department appears anywhere in the source or in the client bundle.

Appointment reminders are stored per-user in the database and served only through the access-gated
API, so they are never compiled into the JavaScript that is served publicly.
