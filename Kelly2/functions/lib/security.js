const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== new URL(request.url).origin) return false;
  if (fetchSite === 'cross-site') return false;
  return true;
}

/**
 * Validate the one-use Cloudflare Turnstile token on the server.
 * Never trust a token merely because the browser rendered a widget.
 */
export async function verifyTurnstile(request, env) {
  const secret = env.TURNSTILE_SECRET_KEY;
  const token = request.headers.get('X-Turnstile-Token') || '';

  if (!env.TURNSTILE_SITE_KEY || !secret) {
    return {
      ok: false,
      status: 503,
      message: 'Security verification is not configured. Add TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY in Cloudflare.'
    };
  }

  if (!token || token.length > 2048) {
    return { ok: false, status: 403, message: 'Security verification is missing. Please try again.' };
  }

  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    const remoteIp = request.headers.get('CF-Connecting-IP');
    if (remoteIp) form.set('remoteip', remoteIp);

    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });

    if (!response.ok) {
      return { ok: false, status: 503, message: 'Security verification is temporarily unavailable.' };
    }

    const result = await response.json();
    const expectedHostname = new URL(request.url).hostname;

    if (!result.success) {
      return { ok: false, status: 403, message: 'Security verification failed. Please try again.' };
    }

    if (result.hostname !== expectedHostname) {
      return { ok: false, status: 403, message: 'Security verification hostname did not match.' };
    }

    if (result.action !== 'kelly_api') {
      return { ok: false, status: 403, message: 'Security verification action did not match.' };
    }

    return { ok: true };
  } catch {
    return { ok: false, status: 503, message: 'Could not reach the security verification service.' };
  }
}
