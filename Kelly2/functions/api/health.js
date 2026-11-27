export async function onRequestGet({ env }) {
  return Response.json({
    ok: true,
    app: 'Kelly',
    ai_ready: Boolean(env.GROQ_API_KEY),
    turnstile_ready: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY),
    turnstile_site_key: env.TURNSTILE_SITE_KEY || '',
    version: '1.1.0'
  }, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
