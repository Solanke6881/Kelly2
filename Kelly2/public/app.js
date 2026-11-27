'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const REMINDERS_KEY = 'kelly.reminders.v1';
const CHAT_KEY = 'kelly.chat.v1';
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

let reminders = loadJson(REMINDERS_KEY, []);
let conversation = loadJson(CHAT_KEY, []);
let pendingReminder = null;
let activeFilter = 'upcoming';
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingMime = '';
let recordingTimer = null;
let recordingStartedAt = 0;
let installPromptEvent = null;
let toastTimer = null;
let turnstileSiteKey = '';
let turnstileWidgetId = null;
let turnstilePending = null;
let apiConfigPromise = null;

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showToast('This device could not save Kelly data. Check browser storage settings.');
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function setVoiceStatus(title, subtitle, recording = false) {
  $('#voice-title').textContent = title;
  $('#voice-subtitle').textContent = subtitle;
  $('#voice-stage').classList.toggle('recording', recording);
  $('#mic-button').setAttribute('aria-label', recording ? 'Stop recording' : 'Start voice recording');
  $('#talk-button').textContent = recording ? 'Stop recording' : 'Start talking';
}

function formattedDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE
  }).format(date);
}

function formattedDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE
  }).format(date);
}

function escapeIcs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function toIcsUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function speakText(text) {
  if (!('speechSynthesis' in window)) {
    showToast('Spoken responses are not supported in this browser.');
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text));
  utterance.lang = 'en-IN';
  utterance.rate = 0.98;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function addMessage(role, text, options = {}) {
  const list = $('#message-list');
  const row = document.createElement('div');
  row.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'Y' : 'K';
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date());
  wrap.appendChild(time);

  if (role !== 'user' && options.speak !== false) {
    const speakButton = document.createElement('button');
    speakButton.type = 'button';
    speakButton.className = 'speak-button';
    speakButton.textContent = '▶ Read aloud';
    speakButton.addEventListener('click', () => speakText(text));
    wrap.appendChild(speakButton);
  }

  if (role === 'user') row.append(wrap, avatar);
  else row.append(avatar, wrap);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;

  conversation.push({ role, content: text });
  conversation = conversation.slice(-16);
  saveJson(CHAT_KEY, conversation);
  return wrap;
}

function addPendingCard(reminder, wrap) {
  const card = document.createElement('div');
  card.className = 'pending-card';
  const heading = document.createElement('strong');
  heading.textContent = 'Ready for your confirmation';
  const details = document.createElement('p');
  details.textContent = `${reminder.task} · ${formattedDateTime(reminder.scheduled_at)}`;
  const actions = document.createElement('div');
  actions.className = 'pending-actions';
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'confirm-button';
  yes.textContent = 'Confirm reminder';
  yes.addEventListener('click', confirmPendingReminder);
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'cancel-button';
  no.textContent = 'Cancel';
  no.addEventListener('click', cancelPendingReminder);
  actions.append(yes, no);
  card.append(heading, details, actions);
  wrap.appendChild(card);
}

function addAssistant(text, options = {}) {
  const wrap = addMessage('assistant', text, options);
  if (options.pending) addPendingCard(options.pending, wrap);
}

function isAffirmative(text) {
  return /^(yes|yeah|yep|correct|confirm|please do|go ahead|sure)(\s+please)?[.! ]*$/i.test(text.trim());
}
function isNegative(text) {
  return /^(no|nope|cancel|don't|do not)[.! ]*$/i.test(text.trim());
}

function persistReminders() {
  saveJson(REMINDERS_KEY, reminders);
  renderReminders();
}

function confirmPendingReminder() {
  if (!pendingReminder) return;
  const reminder = {
    ...pendingReminder,
    id: pendingReminder.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    status: 'confirmed',
    created_at: new Date().toISOString()
  };
  reminders.unshift(reminder);
  pendingReminder = null;
  persistReminders();
  addAssistant(`Done. I've saved “${reminder.task}” for ${formattedDateTime(reminder.scheduled_at)} on this device. You can add it to Apple Calendar for a scheduled iPhone alert.`);
  showToast('Reminder saved on this device.');
}

function cancelPendingReminder() {
  if (!pendingReminder) return;
  pendingReminder = null;
  addAssistant('No problem. I cancelled that reminder.');
}

function renderReminders() {
  const now = Date.now();
  const ordered = [...reminders].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const upcoming = ordered.filter((item) => item.status !== 'completed' && new Date(item.scheduled_at).getTime() >= now);
  const activeCount = reminders.filter((item) => item.status !== 'completed').length;
  $('#nav-reminder-count').textContent = String(activeCount);
  $('#mobile-reminder-count').textContent = String(activeCount);
  $('#reminder-total').textContent = `${reminders.length} reminder${reminders.length === 1 ? '' : 's'}`;

  const compact = $('#home-reminder-list');
  compact.replaceChildren();
  if (!upcoming.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No upcoming reminders yet. Ask Kelly to remember something for you.';
    compact.appendChild(empty);
  } else {
    upcoming.slice(0, 3).forEach((item) => {
      const card = document.createElement('div');
      card.className = 'compact-reminder';
      const time = document.createElement('div');
      time.className = 'reminder-time';
      time.textContent = formattedDateTime(item.scheduled_at);
      const task = document.createElement('strong');
      task.textContent = item.task;
      card.append(time, task);
      compact.appendChild(card);
    });
  }

  const full = $('#full-reminder-list');
  full.replaceChildren();
  let filtered = ordered;
  if (activeFilter === 'upcoming') filtered = ordered.filter((item) => item.status !== 'completed' && new Date(item.scheduled_at).getTime() >= now);
  if (activeFilter === 'done') filtered = ordered.filter((item) => item.status === 'completed');

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = activeFilter === 'done' ? 'No completed reminders yet.' : 'Nothing here yet. Create a reminder from the Home screen.';
    full.appendChild(empty);
    return;
  }

  filtered.forEach((item) => {
    const date = new Date(item.scheduled_at);
    const row = document.createElement('div');
    row.className = `reminder-row${item.status === 'completed' ? ' completed' : ''}`;
    const dateBox = document.createElement('div');
    dateBox.className = 'reminder-date';
    const day = document.createElement('b');
    day.textContent = Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: TIME_ZONE }).format(date);
    const month = document.createElement('small');
    month.textContent = Number.isNaN(date.getTime()) ? 'DATE' : new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: TIME_ZONE }).format(date);
    dateBox.append(day, month);
    const info = document.createElement('div');
    info.className = 'reminder-info';
    const title = document.createElement('strong');
    title.textContent = item.task;
    const sub = document.createElement('small');
    sub.textContent = `${formattedDateTime(item.scheduled_at)} · ${item.status === 'completed' ? 'Completed' : 'Confirmed'}`;
    info.append(title, sub);
    const actions = document.createElement('div');
    actions.className = 'reminder-actions';
    const calendar = document.createElement('button');
    calendar.type = 'button';
    calendar.textContent = 'Add to Calendar';
    calendar.addEventListener('click', () => exportToCalendar(item));
    actions.appendChild(calendar);
    if (item.status !== 'completed') {
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'complete';
      done.textContent = 'Done';
      done.addEventListener('click', () => {
        item.status = 'completed';
        persistReminders();
        showToast('Marked as completed.');
      });
      actions.appendChild(done);
    }
    row.append(dateBox, info, actions);
    full.appendChild(row);
  });
}

function exportToCalendar(reminder) {
  const start = new Date(reminder.scheduled_at);
  if (Number.isNaN(start.getTime())) {
    showToast('This reminder has an invalid date.');
    return;
  }
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const uid = `${reminder.id || Date.now()}@kelly-assistant`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kelly Assistant//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`, `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcs(reminder.task)}`,
    `DESCRIPTION:${escapeIcs('Created with Kelly. Add this event to your calendar to receive an alert.')}`,
    'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcs(reminder.task)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const file = new File([blob], 'kelly-reminder.ics', { type: 'text/calendar' });

  if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    navigator.share({ files: [file], title: 'Add reminder to Calendar', text: 'Open this calendar event and add it to your calendar.' })
      .catch((error) => {
        if (error && error.name !== 'AbortError') downloadIcs(blob);
      });
  } else {
    downloadIcs(blob);
    showToast('Open the downloaded .ics file and add it to Calendar.');
  }
}

function downloadIcs(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kelly-reminder.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function setView(viewName) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${viewName}`));
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === viewName));
  if (viewName === 'reminders') renderReminders();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openInstallHelp() {
  $('#modal-backdrop').hidden = false;
}

function closeInstallHelp() {
  $('#modal-backdrop').hidden = true;
}

function waitForTurnstile(timeoutMs = 15000) {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.turnstile) {
        clearInterval(timer);
        resolve(window.turnstile);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Cloudflare security verification did not load. Check your connection or content blocker.'));
      }
    }, 100);
  });
}

async function loadApiConfig() {
  if (!apiConfigPromise) {
    apiConfigPromise = fetch('/api/health', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Kelly server is unavailable.');
        turnstileSiteKey = String(data.turnstile_site_key || '');
        return data;
      })
      .catch((error) => {
        apiConfigPromise = null;
        throw error;
      });
  }
  return apiConfigPromise;
}

async function getTurnstileToken() {
  const config = await loadApiConfig();
  if (!config.turnstile_ready || !turnstileSiteKey) {
    throw new Error('Security verification is not configured yet. Add the Turnstile site key and secret in Cloudflare Pages settings.');
  }

  const turnstile = await waitForTurnstile();
  return new Promise((resolve, reject) => {
    if (turnstilePending) {
      reject(new Error('A security verification is already in progress. Please try again.'));
      return;
    }

    const settle = (error, token) => {
      if (!turnstilePending) return;
      const pending = turnstilePending;
      turnstilePending = null;
      clearTimeout(pending.timeout);
      if (error) pending.reject(error);
      else pending.resolve(token);
    };

    turnstilePending = {
      resolve,
      reject,
      timeout: setTimeout(() => settle(new Error('Security verification timed out. Please try again.')), 30000)
    };

    const options = {
      sitekey: turnstileSiteKey,
      size: 'normal',
      appearance: 'interaction-only',
      action: 'kelly_api',
      execution: 'execute',
      callback: (token) => settle(null, token),
      'error-callback': () => settle(new Error('Cloudflare could not verify this request. Please try again.')),
      'expired-callback': () => settle(new Error('Security verification expired. Please try again.')),
      'timeout-callback': () => settle(new Error('Security verification timed out. Please try again.'))
    };

    try {
      if (turnstileWidgetId === null) {
        turnstileWidgetId = turnstile.render('#turnstile-container', options);
      } else {
        turnstile.reset(turnstileWidgetId);
      }
      turnstile.execute(turnstileWidgetId);
    } catch {
      settle(new Error('Could not start Cloudflare security verification.'));
    }
  });
}

async function secureApiFetch(url, options = {}) {
  const token = await getTurnstileToken();
  const headers = new Headers(options.headers || {});
  headers.set('X-Turnstile-Token', token);
  return fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
}

async function checkApiHealth() {
  const pill = $('#connection-pill');
  const label = $('#connection-label');
  const apiStatus = $('#api-status');
  const securityStatus = $('#security-status');
  try {
    const data = await loadApiConfig();
    if (data.ai_ready && data.turnstile_ready) {
      pill.classList.add('online');
      pill.classList.remove('offline');
      label.textContent = 'AI connected';
      apiStatus.textContent = 'Connected';
      if (securityStatus) securityStatus.textContent = 'Turnstile active';
    } else {
      pill.classList.remove('online');
      pill.classList.add('offline');
      label.textContent = 'Setup required';
      apiStatus.textContent = data.ai_ready ? 'AI ready' : 'Add Groq secret';
      if (securityStatus) securityStatus.textContent = data.turnstile_ready ? 'Protected' : 'Setup required';
    }
  } catch {
    pill.classList.remove('online');
    pill.classList.add('offline');
    label.textContent = 'API unavailable';
    apiStatus.textContent = 'Not connected';
    if (securityStatus) securityStatus.textContent = 'Unavailable';
  }
}

async function parseWithKelly(userText) {
  const response = await secureApiFetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: conversation.slice(-12),
      now: new Date().toISOString(),
      local_now: new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((parts, item) => { if (item.type !== 'literal') parts[item.type] = item.value; return parts; }, {}),
      timezone: TIME_ZONE,
      locale: navigator.language || 'en-IN'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Kelly API error (${response.status})`);
  return data;
}

async function handleUserTurn(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return;
  $('#message-input').value = '';
  addMessage('user', text);

  if (pendingReminder) {
    if (isAffirmative(text)) {
      confirmPendingReminder();
      return;
    }
    if (isNegative(text)) {
      cancelPendingReminder();
      return;
    }
    addAssistant('I have a reminder waiting for confirmation. Please tap Confirm reminder or Cancel first.');
    return;
  }

  if (/^(what reminders|what do i have|show my reminders|what'?s coming up)[?.! ]*$/i.test(text)) {
    const upcoming = reminders.filter((item) => item.status !== 'completed' && new Date(item.scheduled_at) >= new Date()).sort((a,b) => new Date(a.scheduled_at)-new Date(b.scheduled_at)).slice(0,5);
    if (!upcoming.length) addAssistant('You do not have any upcoming reminders saved on this device yet.');
    else addAssistant(`You have ${upcoming.length} upcoming reminder${upcoming.length === 1 ? '' : 's'}: ${upcoming.map((item) => `${item.task} on ${formattedDateTime(item.scheduled_at)}`).join('; ')}.`);
    return;
  }

  const sendButton = $('.send-button');
  sendButton.disabled = true;
  setVoiceStatus('Kelly is thinking…', 'Understanding your instruction.');
  try {
    const result = await parseWithKelly(text);
    const intent = result.intent;
    if (intent === 'greeting') {
      addAssistant(result.response || 'Hello! How can I help you today?');
    } else if (intent === 'other') {
      addAssistant(result.response || 'I am here to help with reminders and scheduling.');
    } else if (intent === 'create_reminder') {
      const task = String(result.task || '').trim();
      const scheduledAt = String(result.scheduled_at || '').trim();
      const due = scheduledAt ? new Date(scheduledAt) : null;
      if (task && due && !Number.isNaN(due.getTime()) && due.getTime() > Date.now()) {
        pendingReminder = {
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          task,
          scheduled_at: due.toISOString(),
          timezone: TIME_ZONE,
          status: 'pending_confirmation',
          source: 'voice_or_text'
        };
        addAssistant(result.response || 'I have prepared this reminder. Please check the details before saving it.', { pending: pendingReminder });
      } else {
        addAssistant(result.clarification_question || (task ? 'What date and time should I use for this reminder?' : 'What should I remind you about, and when?'));
      }
    } else {
      addAssistant(result.response || result.clarification_question || 'Could you say that another way?');
    }
  } catch (error) {
    addAssistant(`I couldn't reach Kelly's AI service. ${error.message}. Check your internet connection and the Cloudflare Groq secret.`);
    setVoiceStatus('Connection issue', 'You can still review saved reminders.');
  } finally {
    sendButton.disabled = false;
    if (!$('#voice-stage').classList.contains('recording')) {
      setVoiceStatus('Tap to talk to Kelly', 'Speak naturally. I will turn it into a reminder.');
    }
  }
}

function selectRecordingMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function startRecording() {
  if (!window.isSecureContext) {
    showToast('Microphone access requires HTTPS. Open the deployed HTTPS address.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    showToast('This browser does not support in-page audio recording. Please use Safari or type your instruction.');
    return;
  }

  try {
    // Called directly from a user tap; no background microphone access.
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    recordingChunks = [];
    recordingMime = selectRecordingMime();
    mediaRecorder = recordingMime ? new MediaRecorder(recordingStream, { mimeType: recordingMime }) : new MediaRecorder(recordingStream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size) recordingChunks.push(event.data);
    };
    mediaRecorder.onerror = () => {
      stopRecordingCleanup();
      setVoiceStatus('Recording failed', 'Please try again or type your instruction.');
      showToast('The browser could not record audio.');
    };
    mediaRecorder.onstop = processRecording;
    mediaRecorder.start(300);
    recordingStartedAt = Date.now();
    setVoiceStatus('Listening…', 'Tap Stop when you have finished speaking.', true);
    recordingTimer = setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
    }, 30000);
  } catch (error) {
    stopRecordingCleanup();
    const message = error && error.name === 'NotAllowedError'
      ? 'Microphone permission was not granted. Allow access in Safari website settings.'
      : 'Could not access the microphone. Check that no other app is using it.';
    setVoiceStatus('Microphone unavailable', message);
    showToast(message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  clearTimeout(recordingTimer);
  setVoiceStatus('Processing audio…', 'Sending the recording for transcription.');
  $('#voice-stage').classList.remove('recording');
  $('#mic-button').disabled = true;
  $('#talk-button').disabled = true;
}

function stopRecordingCleanup() {
  clearTimeout(recordingTimer);
  if (recordingStream) recordingStream.getTracks().forEach((track) => track.stop());
  recordingStream = null;
  mediaRecorder = null;
}

async function processRecording() {
  const mimeType = (mediaRecorder && mediaRecorder.mimeType) || recordingMime || 'audio/webm';
  const blob = new Blob(recordingChunks, { type: mimeType });
  stopRecordingCleanup();
  recordingChunks = [];
  if (!blob.size) {
    $('#mic-button').disabled = false;
    $('#talk-button').disabled = false;
    setVoiceStatus('No audio captured', 'Please try recording again.');
    return;
  }

  try {
    const form = new FormData();
    const extension = mimeType.includes('mp4') ? 'm4a' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
    form.append('audio', blob, `kelly-voice.${extension}`);
    const response = await secureApiFetch('/api/transcribe', { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Transcription failed (${response.status})`);
    const transcript = String(data.text || '').trim();
    if (!transcript) throw new Error('I could not hear any words. Try again in a quieter place.');
    $('#message-input').value = transcript;
    await handleUserTurn(transcript);
    setVoiceStatus('Tap to talk to Kelly', 'Your spoken instruction was transcribed.');
  } catch (error) {
    addAssistant(`I couldn't transcribe that recording. ${error.message}`);
    setVoiceStatus('Try again', 'Check your microphone permission and connection.');
  } finally {
    $('#mic-button').disabled = false;
    $('#talk-button').disabled = false;
  }
}

function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
  else startRecording();
}

function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPromptEvent = event;
  });
  $('#install-button').addEventListener('click', handleInstall);
  $('#install-inline').addEventListener('click', handleInstall);
  $('#install-settings').addEventListener('click', handleInstall);
  $('#modal-close').addEventListener('click', closeInstallHelp);
  $('#modal-done').addEventListener('click', closeInstallHelp);
  $('#modal-backdrop').addEventListener('click', (event) => {
    if (event.target === $('#modal-backdrop')) closeInstallHelp();
  });
}

async function handleInstall() {
  if (installPromptEvent) {
    installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => null);
    installPromptEvent = null;
    return;
  }
  openInstallHelp();
}

function initNavigation() {
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  $$('[data-open-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.openView)));
  $$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    $$('[data-filter]').forEach((tab) => tab.classList.toggle('active', tab === button));
    renderReminders();
  }));
}

function initChat() {
  $('#chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    handleUserTurn($('#message-input').value);
  });
  $('#message-input').addEventListener('input', (event) => {
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 100)}px`;
  });
  $$('.suggestion').forEach((button) => button.addEventListener('click', () => handleUserTurn(button.dataset.prompt)));
  $('#clear-chat').addEventListener('click', () => {
    if (!confirm('Clear the conversation history on this device? Your saved reminders will remain.')) return;
    conversation = [];
    saveJson(CHAT_KEY, conversation);
    $('#message-list').replaceChildren();
    addAssistant("Hi, I'm Kelly. What would you like to remember?");
  });
}

function initOtherActions() {
  $('#mic-button').addEventListener('click', toggleRecording);
  $('#talk-button').addEventListener('click', toggleRecording);
  $('#clear-data').addEventListener('click', () => {
    if (!confirm('Delete all Kelly reminders and local conversation data from this device? This cannot be undone.')) return;
    reminders = [];
    conversation = [];
    pendingReminder = null;
    localStorage.removeItem(REMINDERS_KEY);
    localStorage.removeItem(CHAT_KEY);
    $('#message-list').replaceChildren();
    addAssistant("Your local Kelly data has been cleared. How can I help?");
    renderReminders();
    showToast('Local Kelly data cleared.');
  });
}

function restoreConversation() {
  const list = $('#message-list');
  if (!conversation.length) return;
  list.replaceChildren();
  conversation.forEach((item) => {
    const row = document.createElement('div');
    row.className = `message ${item.role === 'user' ? 'user-message' : 'assistant-message'}`;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = item.role === 'user' ? 'Y' : 'K';
    const wrap = document.createElement('div');
    wrap.className = 'bubble-wrap';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = item.content;
    wrap.appendChild(bubble);
    if (item.role !== 'user') {
      const read = document.createElement('button');
      read.type = 'button';
      read.className = 'speak-button';
      read.textContent = '▶ Read aloud';
      read.addEventListener('click', () => speakText(item.content));
      wrap.appendChild(read);
    }
    if (item.role === 'user') row.append(wrap, avatar); else row.append(avatar, wrap);
    list.appendChild(row);
  });
  list.scrollTop = list.scrollHeight;
}

function initServiceWorker() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The app remains usable without offline caching.
    });
  }
}

function initDate() {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: '2-digit', hour12: false, timeZone: TIME_ZONE }).format(now));
  $('#home-heading').innerHTML = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}<span class="accent">.</span>`;
  $('#date-chip').textContent = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: TIME_ZONE }).format(now);
}

function initializeKellyApp() {
  initDate();
  initInstallPrompt();
  initNavigation();
  initChat();
  initOtherActions();
  restoreConversation();
  renderReminders();
  checkApiHealth();
  initServiceWorker();
}

initializeKellyApp();
