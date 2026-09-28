/**
 * Swappable email transport (2026-08-20).
 *
 * The channel is not settled — IT has not granted anything yet, and the
 * current sender is a personal mailbox that will later become a shared one. So
 * provider selection is a Firestore value, not a code path: switching is an
 * edit to /config/mail, never a redeploy.
 *
 *   /config/mail = { enabled: bool, provider: string, from: string,
 *                    replyTo: string, allowRecipients: string[] }
 *
 * `allowRecipients` is the safety catch for rollout: while it is non-empty,
 * mail goes ONLY to addresses on that list, whatever the routing computed.
 * First real send is meant to be to the sender's own address alone.
 *
 * ── Why the refresh token is NOT in Firestore ──
 * It is a credential that can send mail as a real person. It lives in Secret
 * Manager and is injected as an env var; /config/mail holds only non-secret
 * switches. Anyone with Firestore read access can see the config; not everyone
 * should be able to send mail as the sender.
 */

const PROVIDERS = ['none', 'gmail-oauth', 'smtp-relay', 'resend', 'teams-flow'];
const APP_URL = 'https://wolfy-ai-library.web.app';

const DEFAULT_CONFIG = {
  // Ships OFF and dry-run. Every event is verified in this mode — recipients
  // and rendered body land in /mailLog — before one real email is sent.
  enabled: true,
  provider: 'none',
  from: 'AI Agent Library <tinnapat.p@arise.tech>',
  replyTo: 'tinnapat.p@arise.tech',
  allowRecipients: [],
  // teams-flow only: recipients outside these domains are skipped, because the
  // Flow bot can only chat with people in the Flow owner's Teams tenant and a
  // cross-tenant failure is invisible to us (the webhook answers 202 first).
  teamsDomains: ['arise.tech'],
};

async function loadConfig(db) {
  try {
    const snap = await db.collection('config').doc('mail').get();
    const d = snap.exists ? snap.data() : {};
    const provider = PROVIDERS.includes(d.provider) ? d.provider : DEFAULT_CONFIG.provider;
    return {
      enabled: d.enabled !== false,
      provider,
      from: d.from || DEFAULT_CONFIG.from,
      replyTo: d.replyTo || DEFAULT_CONFIG.replyTo,
      allowRecipients: Array.isArray(d.allowRecipients)
        ? d.allowRecipients.map((e) => String(e || '').toLowerCase()).filter(Boolean)
        : [],
      teamsDomains: Array.isArray(d.teamsDomains)
        ? d.teamsDomains.map((x) => String(x || '').toLowerCase().replace(/^@/, '')).filter(Boolean)
        : DEFAULT_CONFIG.teamsDomains,
    };
  } catch {
    // A missing or unreadable config must never turn into "send to everyone".
    return { ...DEFAULT_CONFIG };
  }
}

/** RFC 2822 message, base64url-encoded the way the Gmail API wants it. */
function buildRawMessage({ from, replyTo, to, subject, text, html }) {
  const boundary = `b${Date.now().toString(36)}`;
  // Subjects are Thai, so they must be encoded — a raw UTF-8 Subject header is
  // not legal and shows as mojibake in several clients.
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const lines = [
    `From: ${from}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `To: ${to.join(', ')}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64'),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    '',
    `--${boundary}--`,
  ].filter((l) => l !== null);
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Gmail API using a refresh token for the configured mailbox.
 *
 * Deliberately not the googleapis SDK — one token exchange and one POST is
 * less to install and audit than a ~50MB dependency for two HTTP calls.
 */
async function sendViaGmailOAuth({ from, replyTo, to, subject, text, html }) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('gmail-oauth selected but GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN are not set');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenRes.ok) throw new Error(`token refresh failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const { access_token: accessToken } = await tokenRes.json();

  const raw = buildRawMessage({ from, replyTo, to, subject, text, html });
  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!sendRes.ok) throw new Error(`gmail send failed: ${sendRes.status} ${await sendRes.text()}`);
  const body = await sendRes.json();
  return { id: body.id };
}

// ── Microsoft Teams via Power Automate "Flow bot" (2026-09-28) ─────────
// A Teams Workflow ("When a Teams webhook request is received" → "Post card in
// a chat or channel", Post in: Chat with Flow bot, Recipient =
// triggerBody()?['recipient'], Card = triggerBody()?['card']) turns one POST
// into a 1:1 chat for that person. Same technique as the daily-scrum skill's
// channel card, pointed at a person instead. The webhook URL can post as the
// bot, so it is a Secret Manager value (TEAMS_FLOW_URL), never Firestore/git.

/** Adaptive Card 1.4 for one notification — pure, checked by verify-teams.cjs. */
function buildTeamsCard({ subject, title, text, link, endpoint }) {
  // `text` (from notifyRules) opens with the subject line and then the email's
  // <h2> heading — both repeat the title, so the first two lines are dropped.
  // The trailing app URL is replaced by the button.
  const lines = String(text || '').split('\n').filter((l) => l.trim()).slice(2)
    .filter((l) => l.trim() !== APP_URL);
  const actions = [{ type: 'Action.OpenUrl', title: 'Open AI Library', url: link || `${APP_URL}/` }];
  if (endpoint) actions.push({ type: 'Action.OpenUrl', title: 'Open Endpoint', url: endpoint });
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: 'AI Agent Library', size: 'Small', isSubtle: true },
      { type: 'TextBlock', text: title || String(subject || '').replace(/^\[AI Library\]\s*/, ''), weight: 'Bolder', size: 'Medium', wrap: true },
      ...lines.map((l) => ({ type: 'TextBlock', text: l, wrap: true, spacing: 'Small' })),
    ],
    actions,
  };
}

/** Split recipients into those Teams can reach and those it can't. */
function splitTeamsRecipients(to, domains) {
  const ok = new Set((domains || []).map((d) => d.toLowerCase()));
  const send = [];
  const skipped = [];
  to.forEach((e) => (ok.has(String(e).toLowerCase().split('@')[1] || '') ? send : skipped).push(e));
  return { send, skipped };
}

async function sendViaTeamsFlow({ to, subject, title, text, link, endpoint }) {
  const url = process.env.TEAMS_FLOW_URL;
  if (!url) throw new Error('TEAMS_FLOW_URL secret is not set');
  const card = buildTeamsCard({ subject, title, text, link, endpoint });
  const results = [];
  for (const recipient of to) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, subject, card }),
      });
      results.push({ email: recipient, http: r.status });
    } catch (e) {
      results.push({ email: recipient, http: 0, error: String(e?.message || e).slice(0, 200) });
    }
  }
  return results;
}

/**
 * Send one notification. Returns a result object that is ALWAYS written to
 * /mailLog, including for dry runs and failures — the log is the audit trail
 * and the thing verification reads.
 */
async function sendMail(db, { to, subject, text, html, title, link, endpoint }) {
  const cfg = await loadConfig(db);

  if (!cfg.enabled) {
    return { status: 'disabled', provider: cfg.provider, to, subject };
  }

  // Rollout guard: while allowRecipients is set, nobody else can be mailed
  // no matter what routing produced.
  let finalTo = to;
  let held = [];
  if (cfg.allowRecipients.length) {
    const allow = new Set(cfg.allowRecipients);
    held = to.filter((e) => !allow.has(e.toLowerCase()));
    finalTo = to.filter((e) => allow.has(e.toLowerCase()));
    if (!finalTo.length) {
      return { status: 'held', provider: cfg.provider, to, heldFrom: held, subject };
    }
  }

  if (cfg.provider === 'none') {
    return { status: 'dry-run', provider: 'none', to: finalTo, heldFrom: held, subject };
  }

  try {
    if (cfg.provider === 'gmail-oauth') {
      const r = await sendViaGmailOAuth({ ...cfg, to: finalTo, subject, text, html });
      return { status: 'sent', provider: cfg.provider, to: finalTo, heldFrom: held, subject, messageId: r.id || '' };
    }
    if (cfg.provider === 'teams-flow') {
      const { send, skipped } = splitTeamsRecipients(finalTo, cfg.teamsDomains);
      if (!send.length) {
        return { status: 'skipped-domain', provider: cfg.provider, to: finalTo, skippedDomain: skipped, heldFrom: held, subject };
      }
      const teams = await sendViaTeamsFlow({ to: send, subject, title, text, link, endpoint });
      const allOk = teams.every((x) => x.http >= 200 && x.http < 300);
      return { status: allOk ? 'sent' : 'error', provider: cfg.provider, to: send, skippedDomain: skipped, heldFrom: held, subject, teams };
    }
    // smtp-relay / resend are declared in PROVIDERS so the config can be set
    // ahead of time, but are not implemented yet — fail loudly rather than
    // silently pretending to have sent.
    return { status: 'error', provider: cfg.provider, to: finalTo, subject, error: `provider "${cfg.provider}" is not implemented yet` };
  } catch (e) {
    return { status: 'error', provider: cfg.provider, to: finalTo, subject, error: String(e?.message || e).slice(0, 500) };
  }
}

module.exports = { PROVIDERS, DEFAULT_CONFIG, loadConfig, buildRawMessage, sendMail, buildTeamsCard, splitTeamsRecipients };
