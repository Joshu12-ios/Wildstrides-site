# WildStrides Kenya: website

Lean production server for the **WhatsApp-enquiry launch**. Visitors browse the page; booking and the
partner form open WhatsApp. No database, payment keys or email service are needed, so there is very little that can fail.

## What is in the folder

| Path | Purpose |
|---|---|
| `server.js` | Starts the server. Reads settings, refuses to start if they are wrong, shuts down cleanly on deploy. |
| `src/app.js` | The web app: security headers, compression, rate limit, routes, error pages. |
| `src/config.js` | Checks every setting and lists everything wrong at once. |
| `views/index.ejs` | **Your page.** Edit this to change the site. |
| `public/images/` | Put your photos here. File names must match the page **exactly, including capital letters**. |
| `scripts/` | `preflight.js` (before deploy), `smoke.js` (after deploy), `check-images.js`. |
| `test/` | 35 automated tests. |

## First run on your computer

1. Install Node 22 (or 20+), then in this folder run `npm ci` (installs exactly the tested versions).
2. Copy `.env.example` to `.env` and set `WHATSAPP_NUMBER`. For local use you can leave `NODE_ENV` and `SITE_URL` unset.
3. Copy your photos into `public/images/`.
4. `npm test`, then `npm start`, then open http://localhost:4000

## Before EVERY deploy

```
npm test
npm run preflight
```

Both must pass. Preflight checks your settings as production, renders the page, boots the server, and checks every
image. Any line starting with `FAIL` means do not deploy. It also lists claims on the page that you must confirm are true.

## Deploy (Render or Railway, steps are the same shape on both; check each host's current screens)

1. Put the project in a **private** GitHub repository (`.env` is ignored by git, so it is not uploaded).
2. Create a new **Web Service** from that repository. Build command `npm ci`. Start command `npm start`. Health check path `/health`.
3. Node version: the `.node-version` file asks for 22. If your host ignores it, set `NODE_VERSION=22`.
4. Add these environment variables in the host's dashboard: `NODE_ENV=production`, `WHATSAPP_NUMBER`, and `SITE_URL`.
   For the first deploy, `SITE_URL` is the temporary address the host gives you; change it when your domain is live.
5. Choose an **always-on** plan. Plans that go to sleep make the first customer wait a long time. Check current plans and prices.
6. Add your domain in the host's dashboard and create the DNS records it shows. HTTPS certificates are automatic.
   Then set `SITE_URL` to the real address and redeploy.
7. Check the live site: `npm run smoke -- https://yourdomain.co.ke 254740449384`

## Monitoring

Add a free uptime monitor (UptimeRobot, Better Stack) on `https://yourdomain.co.ke/health` with alerts to your phone and email.

## If something breaks

1. **Roll back first, debug second.** Redeploy the previous version from the host's dashboard.
2. Read the logs. A visitor who sees "Something went wrong" also sees a **Reference** code; search the logs for it.
3. Photos or fonts suddenly missing? You probably added a new external source. Set `CSP_MODE=report-only`, then add that
   source to `cspDirectives` in `src/app.js`.
4. `npm run smoke -- <your address>` shows what is failing from the outside.

## Updating the site

Edit `views/index.ejs`, run `npm run preflight`, commit, push (the host redeploys), then run the smoke test.

## Settings

See `.env.example`. Wrong or missing settings stop the app at startup with a clear message, so a bad deploy never goes live.

## Not included on purpose

Payments (Stripe, M-Pesa), a bookings database, email and invoices. The page does not use them, so they only add ways to fail.
When you are ready for them, add them as separate, tested pieces behind switches. Your old project folder still has that code.

## Troubleshooting

| Message | Meaning |
|---|---|
| `Invalid configuration: ... WHATSAPP_NUMBER is not set` | Set it in `.env` (local) or the host's dashboard. |
| `Port 4000 is already in use` | Another copy is running. Close it, or press `Ctrl+C` in its terminal. |
| `image missing` / `wrong letter case` | Fix the file name in `public/images/` to match the page exactly. |
| `Too many requests` | One visitor made over 1000 page requests in 15 minutes. Raise `RATE_LIMIT_MAX` if needed. |
