# Medicine reminders — setup guide

Follow these steps in order. Steps 1–3 take about ten minutes and are done once.
Step 4 is done on the phone that needs the reminders.

> **This is a reminder aid, not medical advice.** It does not replace the prescription or what
> the doctor or pharmacist said. If the app and the prescription disagree, the prescription is right.

**Everything already works except reminders-while-the-app-is-closed.** The checklist, the alarm
sound and the in-app reminders all function right now with no setup. Steps 1–3 are only needed so
the phone can be reminded while the app is shut and the screen is locked.

---

## What the three values are

You need three values. Two are a matched pair, one you invent.

| Value | What it does | Secret? |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Identifies your app to Apple's and Google's push servers. Ships inside the app's JavaScript on purpose. | No |
| `VAPID_PRIVATE_KEY` | Proves the push actually came from your app. Its matching half. | **Yes** |
| `CRON_SECRET` | A password so only your scheduler can trigger reminders. You invent this one. | **Yes** |

The two VAPID keys are a **pair** — they must come from the same generation. Mixing a public key
from one pair with a private key from another silently fails: no error, just no notifications.

### Where to get them

I generated a set for you and put them in the chat message alongside this file — copy them from
there. If you'd rather make your own, or ever need to replace them:

```bash
npx web-push generate-vapid-keys      # prints the public/private pair
openssl rand -hex 32                  # prints a CRON_SECRET
```

The keys look like this (long random text, no spaces):

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY   BOT0js_nOdUCI5ga-90-... (87 characters)
VAPID_PRIVATE_KEY              RUpoW6u11VKnVBZQ...     (43 characters)
CRON_SECRET                    8d8bfe6e4da404ff...     (64 characters)
```

**Never commit the private key or the cron secret.** They belong only in the two dashboards below.
If either ends up in a commit, generate new ones rather than just deleting the line — git keeps
history.

---

## Step 1 — Add the three values to Vercel

1. Go to **[vercel.com/dashboard](https://vercel.com/dashboard)** and click your project.
2. Click **Settings** in the top row of tabs.
3. Click **Environment Variables** in the left sidebar.
4. For each of the three values in turn:
   - **Key** — type the name exactly, e.g. `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   - **Value** — paste the value
   - **Environments** — tick **Production** (ticking Preview and Development too is fine)
   - Click **Save**

Do this three times, once per value. When you're done the list shows all three.

Watch out for:
- **A trailing space or newline** when pasting. This is the single most common cause of
  "everything looks right but nothing works." Click into the value field and check the cursor sits
  immediately after the last character.
- **Name typos.** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` must be exact — the `NEXT_PUBLIC_` prefix is what
  makes it visible to the browser, and without it push silently never starts.

---

## Step 2 — Redeploy (do not skip this)

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is baked into the app's JavaScript when the app is **built**, not
read when it runs. Until you rebuild, the app is still running with no key and push cannot work.

1. Click the **Deployments** tab.
2. Find the deployment at the top of the list.
3. Click the **⋯** menu on its right → **Redeploy** → **Redeploy**.

Wait for it to finish and go green. This takes a minute or two.

---

## Step 3 — Add two secrets to GitHub

This is what triggers reminders on a schedule. It's free.

1. Go to your repository on GitHub: **Maaiz47/Babes-Stock-App**
2. Click **Settings** (the repo's own Settings tab, not your account settings).
3. In the left sidebar: **Secrets and variables** → **Actions**.
4. Click **New repository secret**, twice:

| Name | Value |
|---|---|
| `APP_URL` | Your live site address, e.g. `https://babes-stock-app.vercel.app` — **no trailing slash** |
| `CRON_SECRET` | The **exact same** cron secret you put in Vercel |

**Where to find `APP_URL`:** Vercel dashboard → your project → the **Domains** panel on the
overview page. Use the production domain. Include `https://` at the front and nothing after the
domain name.

`CRON_SECRET` must match Vercel's character for character. If they differ, the scheduler is
rejected every time and the Actions log shows `401`.

---

## Step 4 — Set up the iPhone

**Every step here is required.** Skipping any one means no sound and no notifications.

1. Open the site in **Safari**. It has to be Safari — iOS only lets Safari install a web app.
   Chrome on iPhone cannot do this.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Close Safari. Open the app **from the new icon on the home screen**.
5. Tap the **pink pill icon** in the top bar → **Medicines**.
6. Tap **"Turn on alarms for this device"**.
7. Tap **Allow** when iOS asks about notifications.

Why steps 4 and 6 aren't optional:
- iOS only sends web notifications to an **installed** app, on **iOS 16.4 or newer**. A normal
  Safari tab will never receive them, no matter what else is configured.
- iOS blocks all sound until you've tapped something in the app. That button is what unlocks the
  alarm — until it's tapped, alarms are silent.

Then check on the phone:
- **Settings → Notifications → Babes Stock** — Allow Notifications on, and **Sounds** on.
- The phone isn't in **Silent**, **Focus** or **Do Not Disturb**.

---

## Step 5 — Test that it works

Do these three in order. Each one tests a different part, so if one fails you know exactly where
the problem is.

| # | Test | Where | Proves |
|---|---|---|---|
| 1 | **Test alarm** | Medicines → Settings | The sound works and the volume is right |
| 2 | **Send test notification** | Medicines → Settings | The VAPID keys are correct and the phone is reachable |
| 3 | **Run workflow** | GitHub → Actions → *Medicine reminders* → **Run workflow** | The scheduler, `APP_URL` and `CRON_SECRET` all line up |

For test 3, click into the run afterwards and read the log — it prints what the server replied.
`{"sent":0,...}` is normal when no dose is due right now; it means the whole chain worked.

---

## If something doesn't work

| What you see | What it means | Fix |
|---|---|---|
| "Send test notification" does nothing | The public key wasn't in the build | Redo **Step 2** — redeploy |
| GitHub Actions log shows `401` | The two `CRON_SECRET` values don't match | Re-copy it into both dashboards |
| GitHub Actions log shows `503` | `CRON_SECRET` is missing in Vercel | Redo **Step 1** for that value |
| Notification arrives, no sound | The alarm was never unlocked on that phone | Open the app from the **home screen icon** and tap "Turn on alarms" |
| Nothing at all on iPhone | Opened in a browser tab, not the installed app | Redo **Step 4** from the beginning |
| Reminders arrive several minutes late | Normal — see below | Switch scheduler, see below |

### About late reminders

GitHub's scheduler is free but **best-effort**. Runs are often a few minutes late and can slip 10–20
minutes when GitHub is busy. The app compensates by looking backwards, so a late run still finds the
dose and still sends — but the notification can land after the dose time.

If that matters, **[cron-job.org](https://cron-job.org)** is also free, runs every minute, and is far
more punctual. Sign up, create a job pointing at:

```
URL:    https://your-app.vercel.app/api/meds/dispatch
Method: POST
Header: Authorization: Bearer <your CRON_SECRET>
```

Then disable the GitHub workflow (Actions → *Medicine reminders* → **⋯** → Disable workflow).
Nothing in the app needs to change.

### One honest limitation

A web notification **cannot** override iPhone Silent mode or Focus the way a native alarm app can.
For a dose that genuinely must not be missed, set a normal iOS Clock alarm as a backup.

---

## Everyday use

- **Who can see it:** the pill icon only appears for the username listed in
  `src/lib/meds-access.ts`, plus any admin account. To add someone, add their username to
  `MEDS_USERNAMES` and redeploy.
- **The schedule** preloads from the prescription on first visit. Everything is editable under
  Medicines → Medicines: times, frequency, course length, food instructions, colours.
  **Reset to prescription defaults** puts it all back.
- **Times are Maldives time (UTC+5).** Change under Medicines → Settings → timezone offset.
- **Alarm behaviour** — sound, volume, how often a missed dose repeats, how many times, and snooze
  length — is under Medicines → Settings.
- **There are no quiet hours, deliberately.** A missed dose is exactly the thing that should wake
  her, so nothing in the app silences a reminder based on the time of day.

## Privacy

Only the medication regimen is in the repository. No patient name, hospital number, address,
diagnosis, clinician name or department appears in the source or in anything served to a browser.
Appointment reminders live in the database per user and are served only through the access-gated
API, so they are never compiled into public JavaScript.
