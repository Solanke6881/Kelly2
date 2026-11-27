# Kelly Pages deployment checklist

## Before deployment
- [ ] Revoke any Groq key that has been shared in chat, screenshots, source control, or other public places.
- [ ] Create a replacement Groq API key.
- [ ] Upload this folder's contents directly to the GitHub repository root.
- [ ] Confirm `functions/` and `public/` are sibling folders at the repository root.

## Cloudflare Pages project
- [ ] Product: Cloudflare Pages (not a standard Worker build).
- [ ] Framework preset: None.
- [ ] Build command: blank.
- [ ] Build output directory: `public`.
- [ ] Root directory: `/`.
- [ ] Production branch: `main` (or the branch you selected).
- [ ] Do not set `npx wrangler deploy` as a Pages Git deploy command.

## Turnstile
- [ ] Deploy once to obtain the final `*.pages.dev` hostname.
- [ ] Create a Cloudflare Turnstile widget in Managed mode.
- [ ] Allow the exact Pages hostname (or your custom hostname).
- [ ] Copy its Sitekey and Secret key.

## Pages production variables and secrets
Add these under Settings → Variables and Secrets → Production:

| Name | Type | Value |
|---|---|---|
| `GROQ_API_KEY` | Encrypted secret | A newly generated Groq API key |
| `TURNSTILE_SECRET_KEY` | Encrypted secret | Turnstile widget secret key |
| `TURNSTILE_SITE_KEY` | Plain variable | Turnstile public sitekey |

No application access password is required. No application password variable is used or required.

Save and trigger a fresh deployment after adding all three values.

## Verify
- [ ] Open the deployed Pages URL.
- [ ] The app opens directly without an application password screen.
- [ ] Connection indicator shows AI connected once Groq and Turnstile are configured.
- [ ] Send a text reminder and complete confirmation.
- [ ] Record a short voice instruction and verify transcription.
- [ ] Check the Cloudflare Turnstile analytics and Pages Function logs if a request fails.

## Security note
Turnstile is bot protection, not personal identity authentication. Anyone who visits the public site may be able to use Kelly after passing the check. For private access, protect the hostname with Cloudflare Access or add an identity provider. Keep Groq and Turnstile secret keys in Cloudflare encrypted secrets only.
