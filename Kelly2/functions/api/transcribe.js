import { sameOrigin, verifyTurnstile } from '../lib/security.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

function error(message, status = 400) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return error('Request origin was rejected.', 403);
  const verification = await verifyTurnstile(request, env);
  if (!verification.ok) return error(verification.message, verification.status);
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_AUDIO_BYTES + 1024 * 1024) return error('Audio upload is too large.', 413);
  if (!env.GROQ_API_KEY) return error('Kelly speech recognition is not configured. Add GROQ_API_KEY in Cloudflare Pages secrets.', 503);

  let form;
  try { form = await request.formData(); } catch { return error('Could not read the audio upload.'); }
  const audio = form.get('audio');
  if (!(audio instanceof File)) return error('Audio file is missing.');
  if (audio.size < 1) return error('The audio recording is empty.');
  if (audio.size > MAX_AUDIO_BYTES) return error('Audio is too large. Please record a shorter instruction (maximum 12 MB).', 413);

  try {
    const upstreamForm = new FormData();
    upstreamForm.append('file', audio, audio.name || 'kelly-voice.webm');
    upstreamForm.append('model', 'whisper-large-v3-turbo');
    upstreamForm.append('response_format', 'json');
    upstreamForm.append('temperature', '0');
    upstreamForm.append('prompt', 'A personal assistant voice instruction about reminders, calendars, dates, meetings, office schedules and tasks. Preserve spoken names and time expressions.');

    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
      body: upstreamForm
    });

    if (!upstream.ok) {
      const details = await upstream.text();
      return error(`Speech provider request failed (${upstream.status}). ${details.slice(0, 250)}`, 502);
    }

    const data = await upstream.json();
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) return error('No speech was detected. Please try again.', 422);
    return Response.json({ text }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return error('Could not connect to the speech recognition provider.', 502);
  }
}
