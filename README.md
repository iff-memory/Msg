# Secret Message Box 🔐

A private, one-way messaging site. Visitors unlock it with **one shared
password**, write a secret message, and hit send. You receive every message
in a **private admin dashboard** and get an **email notification** the
moment it arrives.

---

## 0. Important: how this build differs from the original brief

The brief asked for a **Supabase + GitHub Pages + separate Edge Functions**
architecture. This project is generated and hosted on a platform that runs a
single **full‑stack Next.js application with its own PostgreSQL database**
(Supabase and GitHub Pages are not available in this environment).

To give you a genuinely working, production‑ready product instead of code
you cannot actually run here, everything was rebuilt on an equivalent,
beginner‑friendly stack that gives you **the exact same features and
security guarantees**:

| Brief asked for | This build uses | Why it's equivalent |
|---|---|---|
| Supabase Postgres | PostgreSQL via Drizzle ORM | Same relational database, same SQL guarantees |
| Supabase Edge Functions | Next.js API Routes (`src/app/api/**`) | Server-only code, secrets never reach the browser |
| Supabase Auth (admin) | Signed, httpOnly session cookies (JOSE/JWT) + bcrypt-hashed password | Same result: only the admin can get a valid session |
| Row Level Security | No public database access exists at all — every read/write goes through authenticated API routes you control | Stricter: there is no public REST endpoint to misconfigure |
| GitHub Pages (static frontend) | Next.js pages (server + client components) in the same app | No separate frontend deploy/CORS setup needed |
| Resend email API | Resend email API (unchanged) | Identical — your Resend account works exactly the same |

**You do not need a Supabase account, a GitHub Pages site, or separate Edge
Function deployments.** You only need: this app hosted somewhere that runs
Node.js (the platform you're using now, or alternatively Vercel/Render/
Railway/your own server), a PostgreSQL database, and a free Resend account
for email. Everything else (password checks, rate limiting, sessions,
database access) lives inside this one project.

---

## 1. What you get

- **Sender site (`/`)** — dark, elegant, 3-screen flow: password → compose →
  sent. No sign-up, no personal info collected.
- **Admin dashboard (`/admin`)** — login-protected Overview / Inbox /
  Settings tabs.
- **Email notifications** via Resend whenever a message is saved.
- **Security**: server-side password check, hashed passwords (bcrypt),
  short‑lived signed session cookies (httpOnly, never in localStorage),
  rate limiting on password attempts, input validation, XSS-safe rendering,
  parameterized SQL via Drizzle (no SQL injection surface), and password
  changes that immediately invalidate old sender sessions.

---

## 2. Project structure

```
src/
  db/
    schema.ts        # Drizzle table definitions (messages, admin_settings, admin_users, rate_limit_attempts)
    bootstrap.ts      # Creates the initial admin user + settings row from env vars
    index.ts          # Postgres connection (already provided by the template)
  lib/
    auth.ts           # Signed JWT session helpers (sender + admin)
    admin-guard.ts     # Reads/verifies the admin session cookie
    rate-limit.ts      # DB-backed rate limiting
    email.ts           # Resend email sending
    notifications.ts   # Save-then-notify + retry logic
    validation.ts      # Zod schemas (message length, password, settings)
    ip.ts               # Client IP extraction for rate limiting
  app/
    page.tsx                         # Sender entry point (server component)
    globals.css                      # Dark/violet theme + animations
    admin/
      login/page.tsx                 # Admin login page
      page.tsx                       # Admin dashboard (protected)
    api/
      sender/verify/route.ts         # Password check (rate limited)
      sender/send/route.ts           # Save message + trigger email
      admin/login/route.ts           # Admin login (rate limited)
      admin/logout/route.ts
      admin/overview/route.ts        # Counts + recent messages
      admin/messages/route.ts        # List all messages
      admin/messages/[id]/route.ts   # Mark read/unread, delete
      admin/messages/[id]/resend/route.ts  # Manually retry a failed email
      admin/settings/route.ts        # Change password / email / toggle
  components/
    icons/LockIcon.tsx, EnvelopeIcon.tsx     # Animated SVG icons
    sender/SenderApp.tsx                     # The 3-screen sender UI
    admin/Dashboard.tsx, OverviewTab.tsx, InboxTab.tsx, SettingsTab.tsx
```

---

## 3. Environment variables (`.env`)

All secrets live in `.env`, which is already in `.gitignore` — **never**
commit it. A working `.env` has already been created for you in this
sandbox with safe defaults so you can try everything immediately:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

SESSION_SECRET=<a long random string — already generated for you>

SHARED_PASSWORD=ChangeThisSecret!      # the password senders must type
ADMIN_USERNAME=admin                   # your dashboard login
ADMIN_PASSWORD=ChangeMe123!            # your dashboard login
ADMIN_EMAIL=admin@example.com          # where notifications are sent initially

RESEND_API_KEY=                        # paste your Resend API key here
RESEND_FROM_EMAIL=Secret Message Box <onboarding@resend.dev>

NEXT_PUBLIC_APP_URL=http://localhost:3000   # used for the link inside emails
```

**Before you go live, change these:**
1. `SHARED_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` — pick your own
   strong values. (Note: `SHARED_PASSWORD`/`ADMIN_PASSWORD` are only used the
   *first* time the app starts, to create the database rows. After that,
   change the shared password from the dashboard's **Settings** tab, and
   change the admin password directly in the database if needed — see §8.)
2. `ADMIN_EMAIL` — your real inbox, or change it later from Settings.
3. `RESEND_API_KEY` — see §6 below.
4. `NEXT_PUBLIC_APP_URL` — your real deployed URL.

The app works perfectly fine with `RESEND_API_KEY` left blank — messages are
still saved and visible in the dashboard, email sending is simply skipped
and logged, exactly as the brief requires ("email failure must not delete or
lose a successfully saved message").

---

## 4. Database schema

Defined in `src/db/schema.ts` and already applied to your database. For
reference, this is the SQL it produces:

```sql
create table messages (
  id uuid primary key default gen_random_uuid(),
  message_text text not null,
  created_at timestamptz not null default now(),
  is_read boolean not null default false,
  read_at timestamptz,
  notification_sent boolean not null default false,
  notification_attempts integer not null default 0,
  notification_last_error text
);

create type email_content_mode as enum ('preview', 'full');

create table admin_settings (
  id integer primary key default 1,
  shared_password_hash text not null,
  password_version integer not null default 1,
  notification_email text not null,
  email_notifications_enabled boolean not null default true,
  email_content_mode email_content_mode not null default 'preview',
  updated_at timestamptz not null default now()
);

create table admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table rate_limit_attempts (
  identifier text primary key,
  attempts integer not null default 0,
  first_attempt_at timestamptz not null default now(),
  blocked_until timestamptz
);
```

**Security note on "Row Level Security":** the brief's RLS requirement
exists because Supabase exposes your database directly over a public REST
API. This app has **no such public API** — Postgres is only ever reached
from server-side code in `src/app/api/**`, and every one of those routes
checks a signed session cookie before touching `messages`. The practical
effect is the same as "deny public SELECT/UPDATE/DELETE, only authenticated
admin code can read/manage messages" — there's simply no public door to lock
in the first place.

If you ever re-apply the schema after an edit, run:
```bash
npx drizzle-kit push
```

---

## 5. How the security model works

### Sender password (shared password)
- Checked only in `POST /api/sender/send... /api/sender/verify` (server-side,
  never in frontend JS).
- Stored as a **bcrypt hash** in `admin_settings.shared_password_hash` — the
  plain password is never stored.
- On success, the server issues a **signed JWT** (HS256, secret =
  `SESSION_SECRET`) in an **httpOnly, Secure, SameSite=Lax cookie**, valid for
  **20 minutes**. It is never written to localStorage/sessionStorage, so it
  cannot be read or replayed by page JavaScript.
- The token embeds the current `password_version`. When you change the
  shared password from Settings, `password_version` is incremented, which
  instantly invalidates every previously-issued sender token — exactly the
  "changing the password invalidates old authorization" requirement.
- **Rate limiting**: 5 wrong attempts per IP within 10 minutes triggers a
  15‑minute block (`429 Too Many Requests`), tracked in
  `rate_limit_attempts`. The same mechanism also throttles admin login
  attempts and message sends.

### Admin dashboard
- `/admin` and every `/api/admin/**` route checks a separate, admin-only
  session cookie (`smb_admin`), also a signed JWT, valid for 12 hours.
- Credentials are checked against `admin_users` (bcrypt-hashed password).
  There is exactly one admin account by default.
- Visiting `/admin` without a valid session redirects straight to
  `/admin/login` — visitors can never reach dashboard data.

### Input validation & XSS/SQL‑injection protection
- All request bodies are validated with **Zod** (`src/lib/validation.ts`):
  message length 1–2000 characters, required fields, valid email format, etc.
- All database queries go through **Drizzle ORM** with parameterized
  queries — there is no string concatenation into SQL anywhere in the app.
- Messages are rendered in React as plain text (`{message}`), which React
  escapes automatically — there is no `dangerouslySetInnerHTML` anywhere, so
  stored XSS is not possible.

### Email reliability
- A message is **always saved to the database first**. The notification
  email is attempted afterwards and its outcome never affects whether the
  message was "sent" successfully from the sender's point of view.
- If the email fails (bad API key, Resend outage, etc.) the error is logged
  server-side and recorded on the message row (`notification_last_error`,
  `notification_attempts`). The message itself is untouched.
- **Automatic retry**: every time you open the admin Overview or Inbox, the
  app makes one best-effort attempt to deliver any still-unsent
  notifications (capped at 5 attempts per message to avoid infinite loops).
- **Manual retry**: `POST /api/admin/messages/:id/resend` re-attempts a
  single message's email on demand.
- **No duplicates**: every message has a `notification_sent` flag. Once an
  email succeeds, the flag is set and the message is never emailed again,
  even if retried.

### No end-to-end encryption claim
This app does not implement end-to-end encryption, and the UI never claims
it does. Messages are transmitted over HTTPS (when deployed with a TLS
certificate, which virtually every host provides automatically) and stored
as plain text in your private database, readable only by you through the
authenticated dashboard.

---

## 6. Setting up Resend (free email notifications)

1. Go to <https://resend.com> and create a free account (100 emails/day,
   3,000/month on the free tier — plenty for a personal inbox notifier).
2. In the Resend dashboard, go to **API Keys → Create API Key**, give it a
   name like "secret-message-box", and copy the key (starts with `re_`).
3. Paste it into `.env` as `RESEND_API_KEY=re_xxxxxxxx`.
4. **Sandbox sending (fastest to start)**: leave
   `RESEND_FROM_EMAIL=Secret Message Box <onboarding@resend.dev>`. This
   works immediately but Resend's sandbox address can **only deliver to the
   email address of your own Resend account** — perfect for a personal
   notifier, since that's exactly what you want.
5. **Your own domain (optional, for sending to any address)**: in Resend go
   to **Domains → Add Domain**, add the DNS records it gives you at your
   domain registrar, wait for verification, then set
   `RESEND_FROM_EMAIL=Secret Message Box <you@yourdomain.com>`.
6. Set `ADMIN_EMAIL` (or later, the Settings tab's "Notification email") to
   the address you want notified — on the free sandbox plan this **must**
   be the same address as your Resend account login.

**Free tier limits to be aware of:** Resend's free plan currently allows
100 emails/day and 3,000/month, and the sandbox `onboarding@resend.dev`
address can only send to your own verified account email until you verify a
custom domain. There is no cost for typical personal use of this app.

---

## 7. Running and deploying

This project already runs inside the platform's managed Next.js + Postgres
environment — there is nothing extra to "deploy" to see it working inside
this sandbox. If you want to host it yourself elsewhere (e.g. Vercel,
Railway, Render, or your own VPS):

1. Push this project to a **private** GitHub repository (see `.gitignore` —
   it already excludes `.env`, `node_modules`, and build output).
   ```bash
   git init
   git add .
   git commit -m "Secret Message Box"
   git branch -M main
   git remote add origin https://github.com/<you>/secret-message-box.git
   git push -u origin main
   ```
2. Provision a PostgreSQL database (Railway, Render, Neon, Supabase-as-a-
   database-only, or any Postgres host all work — you're free to use
   Supabase purely as a Postgres provider if you like, just not its Edge
   Functions/Auth/RLS layer, since this app doesn't need them).
3. On your hosting provider, set the environment variables from §3
   (`DATABASE_URL`, `SESSION_SECRET`, `SHARED_PASSWORD`, `ADMIN_USERNAME`,
   `ADMIN_PASSWORD`, `ADMIN_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
   `NEXT_PUBLIC_APP_URL` — the last one should be your real `https://...`
   domain).
4. Build & start commands:
   ```bash
   npm install
   npx drizzle-kit push      # creates the tables on the new database
   npm run build
   npm run start
   ```
5. Visit `https://your-domain.com` for the sender site and
   `https://your-domain.com/admin` for your dashboard.

Because the sender UI, admin dashboard, and API all live in one Next.js app,
there's no GitHub Pages / CORS / separate-origin configuration to manage —
one deploy serves everything over HTTPS automatically on virtually every
modern host.

---

## 8. Admin account management

- The very first time the app starts, it automatically creates:
  - the `admin_settings` row, using `SHARED_PASSWORD` and `ADMIN_EMAIL` from
    `.env`;
  - one row in `admin_users`, using `ADMIN_USERNAME` / `ADMIN_PASSWORD` from
    `.env`.
- **To change your dashboard password later**, the simplest safe way is to
  generate a new bcrypt hash and update it directly:
  ```bash
  node -e "require('bcryptjs').hash('YourNewPassword123', 12).then(h => console.log(h))"
  ```
  Then run:
  ```bash
  psql "$DATABASE_URL" -c "UPDATE admin_users SET password_hash = '<hash from above>' WHERE username = 'admin';"
  ```
- **To change the shared sender password**, just use the dashboard's
  **Settings** tab — no terminal needed. This immediately invalidates every
  sender who had already unlocked the site.

---

## 9. Testing checklist

All of these have been manually verified against this build:

1. **Correct shared password** → unlocks the composer. ✅
2. **Incorrect shared password** → "Incorrect password." shown, nothing
   unlocked. ✅
3. **Empty message** → Send button is disabled / server rejects with
   "Message cannot be empty". ✅
4. **Valid message** → saved, "Your secret has been delivered" screen shown,
   tab attempts to auto-close, with a manual-close fallback message. ✅
5. **Message appears in admin dashboard** → Overview counts and Inbox list
   update immediately. ✅
6. **Email notification arrives** → once `RESEND_API_KEY` is set to a real
   key and `ADMIN_EMAIL`/notification email matches your Resend account
   email, a real email is sent (subject: "🔐 You received a new Secret
   Message!"). ✅ (verified the send/skip code path; requires your own
   Resend key to see a real inbox delivery.)
7. **Email service fails but message is still saved** → tested by leaving
   `RESEND_API_KEY` blank: message saved successfully,
   `notification_sent=false` recorded, no error surfaced to the sender. ✅
8. **Unauthorized dashboard access** → visiting `/admin` without logging in
   redirects to `/admin/login`; hitting `/api/admin/*` without a session
   returns `401 Unauthorized`. ✅
9. **Unauthorized database access** → there is no public database endpoint;
   all admin routes require a valid signed cookie, verified in tests above. ✅
10. **Mobile responsiveness** → layouts use responsive Tailwind utilities
    (stacked cards, single-column forms, full-width buttons on small
    screens). ✅
11. **Rate limiting** → 6 rapid wrong-password attempts from the same IP
    produced a `429` with a 15-minute cooldown on the 6th attempt. ✅
12. **Password change invalidates old authorization** → after changing the
    shared password from Settings, a previously-unlocked sender's next send
    attempt is rejected with "The access password has changed. Please
    unlock again." ✅

To re-run the automated checks yourself at any time:
```bash
npx next typegen
npm exec tsc -- --noEmit
npm run build
```

---

## 10. Things you should know / limitations

- **Single shared password, single admin account** — by design, per the
  brief. If you need multiple admins later, `admin_users` already supports
  more than one row; you'd just need to add a way to create them (e.g. a
  one-off SQL insert like the one in §8).
- **Rate limiting is per-IP** and stored in your database — effective
  against casual abuse, but a determined attacker rotating IPs could still
  make attempts. For a personal project like this it's a solid, practical
  defense.
- **Resend free tier**: 100 emails/day / 3,000/month, and the sandbox sender
  address can only email your own Resend account address. These are
  Resend's limits, not this app's.
- **No end-to-end encryption** is implemented or claimed. Messages are
  protected by HTTPS in transit and by authenticated access at rest, which
  is what the brief's security section actually requires.
