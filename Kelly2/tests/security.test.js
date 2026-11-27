import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOrigin, verifyTurnstile } from '../functions/lib/security.js';

const originalFetch = globalThis.fetch;

test('sameOrigin rejects a foreign Origin', () => {
  const request = new Request('https://kelly.example.com/api/parse', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' }
  });
  assert.equal(sameOrigin(request), false);
});

test('sameOrigin accepts a matching Origin', () => {
  const request = new Request('https://kelly.example.com/api/parse', {
    method: 'POST',
    headers: { Origin: 'https://kelly.example.com' }
  });
  assert.equal(sameOrigin(request), true);
});

test('Turnstile verification rejects missing configuration', async () => {
  const request = new Request('https://kelly.example.com/api/parse', {
    method: 'POST',
    headers: { 'X-Turnstile-Token': 'dummy-token' }
  });
  const result = await verifyTurnstile(request, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('Turnstile verification accepts a valid, host-bound, action-bound token', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('secret'), 'test-secret');
    assert.equal(body.get('response'), 'valid-token');
    return Response.json({
      success: true,
      hostname: 'kelly.example.com',
      action: 'kelly_api'
    });
  };

  try {
    const request = new Request('https://kelly.example.com/api/parse', {
      method: 'POST',
      headers: { 'X-Turnstile-Token': 'valid-token' }
    });
    const result = await verifyTurnstile(request, {
      TURNSTILE_SITE_KEY: 'public-site-key',
      TURNSTILE_SECRET_KEY: 'test-secret'
    });
    assert.deepEqual(result, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Turnstile verification rejects hostname mismatch', async () => {
  globalThis.fetch = async () => Response.json({
    success: true,
    hostname: 'attacker.example',
    action: 'kelly_api'
  });
  try {
    const request = new Request('https://kelly.example.com/api/parse', {
      method: 'POST',
      headers: { 'X-Turnstile-Token': 'valid-token' }
    });
    const result = await verifyTurnstile(request, {
      TURNSTILE_SITE_KEY: 'public-site-key',
      TURNSTILE_SECRET_KEY: 'test-secret'
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
