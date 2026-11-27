# Kelly — Mobile-first Personal Voice Assistant (PWA V1.1)

Kelly is a mobile-first installable web app for iPhone Safari and desktop browsers. It provides tap-to-talk voice capture, Groq Whisper transcription, structured reminder understanding, confirmation/cancellation, local reminder storage, and `.ics` calendar export.

## What is included

- Installable PWA shell for iPhone Home Screen and desktop browsers.
- Tap-to-talk microphone capture using `getUserMedia()` and `MediaRecorder`.
- Groq Whisper transcription through a same-origin Cloudflare Pages Function.
- Groq structured-output reminder understanding through a same-origin Pages Function.
- User confirmation/cancellation before saving a reminder.
- Local reminder and conversation storage in the current browser/device.
- `.ics` calendar export for importing reminders into Apple Calendar.
- No app-level access password or login screen.
- Cloudflare Turnstile verification on the AI/transcription API endpoints.
- Groq credentials remain server-side in Cloudflare encrypted secrets.

## Security model — read this

Kelly has **no application password or user login** in this version. Cloudflare Turnstile is used as password-free bot verification on AI endpoints. Turnstile is not user authentication and does not make the website private: anyone who visits the public site may be able to use the app after passing verification. If you need access restricted to only you, protect the Pages hostname with Cloudflare Access or add a real identity provider in a later step.

Turnstile tokens are validated server-side with Cloudflare Siteverify, are single-use, and expire after five minutes. Never trust client-side Turnstile success without server-side validation.

The Groq API key must never be committed to GitHub, placed in frontend code, or included in this ZIP. A Groq API key was previously pasted into a chat; revoke that key and create a replacement before deployment. Add the replacement only as an encrypted Cloudflare Pages secret.

## Project structure

```text
kelly-personal-assistant/
├── functions/
│   ├── api/
│   │   ├── health.js
│   │   ├── parse.js
│   │   └── transcribe.js
│   └── lib/
│       └── security.js
├── public/
│   ├── icons/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── manifest.webmanifest
│   ├── _headers
│   └── sw.js
├── .dev.vars.example
├── .gitignore
├── package.json
├── wrangler.toml
└── README.md
```

## Deploy with GitHub + Cloudflare Pages

1. Revoke any Groq key previously pasted into chat or committed anywhere. Create a fresh key.
2. Upload the **contents of this project folder** to the GitHub repository root. The root must contain `functions/`, `public/`, `package.json`, and `wrangler.toml` directly.
3. In Cloudflare Dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and select the repository.
4. Set:
   - Framework preset: **None**
   - Build command: leave blank
   - Build output directory: `public`
   - Root directory: `/`
   - Production branch: your chosen branch (for example `main`)
5. Deploy once. Pages Functions are deployed through Git integration or Wrangler, not static drag-and-drop Direct Upload.
6. After the initial deployment, note the exact hostname, for example `kelly-personal-assistant-pages.pages.dev`.
7. In Cloudflare Dashboard, open **Turnstile → Add widget**. Choose **Managed** mode and add the exact Pages hostname (or your custom domain). Create the widget and copy its Sitekey and Secret key.
8. In the Pages project, open **Settings → Variables and Secrets → Production** and add:
   - `GROQ_API_KEY` — **encrypted secret** containing the newly created Groq key.
   - `TURNSTILE_SECRET_KEY` — **encrypted secret** from the Turnstile widget.
   - `TURNSTILE_SITE_KEY` — public sitekey as a normal variable (not secret).
9. Save and trigger a new production deployment. The frontend reads the public sitekey from `/api/health`; the server validates each single-use token against Siteverify.
10. Open the `pages.dev` URL. Check the connection pill. Both Groq and Turnstile must show as configured before AI requests work.

### Cloudflare Pages build settings

- Framework preset: None
- Build command: empty
- Build output directory: `public`
- Root directory: `/`
- Deploy command: do not set a custom `npx wrangler deploy` command in the Pages Git build settings.

The project uses a root-level `functions/` directory. Do not move it inside `public/`.

## Additional rate limiting recommendation

Turnstile helps block automated bot traffic but is not a substitute for usage limits or identity authentication. For a public Pages hostname, configure a Cloudflare WAF rate-limiting rule for `/api/parse` and `/api/transcribe` where available on your plan. Start conservatively (for example, limit repeated requests per IP over a short window) and monitor legitimate use. Cloudflare plan capabilities and dashboard labels can change.

## Run locally

Install Node.js, then:

```bash
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with a fresh Groq key and real Turnstile keys. Keep `.dev.vars` untracked (it is ignored by `.gitignore`). For local testing, create a separate Turnstile widget that authorizes `localhost`, or use Cloudflare's documented Turnstile test keys for development only.

```bash
npm run dev
```

Run syntax checks and tests:

```bash
npm run check
npm test
```

## iPhone installation

1. Open the deployed HTTPS URL in Safari (not an in-app browser).
2. Tap Share → Add to Home Screen.
3. Keep **Open as Web App** enabled, then tap Add.
4. Launch Kelly from its Home Screen icon.
5. Tap Start talking and grant microphone permission when iOS prompts.
6. Turnstile may run transparently; if it requires an interaction, complete the on-screen Cloudflare check and retry the request.

## Important limitations

- No always-on custom “Hey Kelly” wake word. iOS does not allow an ordinary PWA to continuously listen while closed/backgrounded.
- Microphone capture begins only after the user taps while Kelly is open.
- No server push notification scheduler in this release. Use the `.ics` export to import reminder events into Apple Calendar for alerts managed by iOS Calendar.
- No cross-device sync yet. Reminders and chat history are local to each browser/device.
- Excel/PDF/image extraction is a later milestone; the Files screen is currently a roadmap placeholder.
- Confirmed reminders are saved in Kelly's local browser storage; Kelly itself does not yet fire background alerts.
- AI usage depends on Groq account quotas and model availability. Check the Groq console for current limits.

## Privacy and data handling

- Never put `GROQ_API_KEY` in `public/app.js`, HTML, local storage, a committed environment file, or this ZIP.
- The browser sends requests to same-origin Pages Functions; only the server adds the Groq secret to upstream requests.
- Voice audio is sent to Groq only after the user records and submits a command. The app does not persist the audio blob in local storage.
- Recent text conversation context is sent to Groq for instruction interpretation.
- Cloudflare Turnstile processes browser signals for anti-bot verification. See Cloudflare's Turnstile privacy and documentation pages.
- Reminders and chat history are stored in browser local storage, which is not encrypted by this app. Avoid highly sensitive content on shared devices.
- No camera or geolocation permission is requested.

## Official references

- Cloudflare Pages Functions: https://developers.cloudflare.com/pages/functions/
- Cloudflare Turnstile setup: https://developers.cloudflare.com/turnstile/get-started/
- Cloudflare Turnstile server validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Groq API: https://console.groq.com/docs
