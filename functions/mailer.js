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
const { APP_URL, NAME_TOKEN, personalize, salutation } = require('./messageFrame');

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
      approverOverride: Array.isArray(d.approverOverride)
        ? d.approverOverride.map((e) => String(e || '').toLowerCase()).filter(Boolean)
        : [],
      // Email through the same Flow (shared mailbox). Off until the flow has the email branch.
      emailEnabled: d.emailEnabled === true,
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

/**
 * Adaptive Card 1.4 for one notification — pure, checked by verify-teams.cjs.
 * `cardLines` (from notifyRules / renderDigest) are the message rows: markdown
 * links are allowed, and a line wrapped in ** becomes a bold group heading.
 * The button appears only when the message is about ONE item (`ctaLabel`);
 * a multi-item digest carries its links on the rows and has no button.
 */
function buildTeamsCard({ subject, title, cardLines = [], link, endpoint, ctaLabel }) {
  const actions = [];
  if (ctaLabel) actions.push({ type: 'Action.OpenUrl', title: ctaLabel, url: link || `${APP_URL}/` });
  if (endpoint) actions.push({ type: 'Action.OpenUrl', title: 'Open endpoint', url: endpoint });
  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: 'AI Agent Library', size: 'Small', isSubtle: true },
      { type: 'TextBlock', text: title || String(subject || '').replace(/^\[AI Library\]\s*/, ''), weight: 'Bolder', size: 'Medium', wrap: true },
      { type: 'TextBlock', text: `เรียน ${NAME_TOKEN}`, wrap: true, spacing: 'Small' },
      ...cardLines.map((l) => {
        const h = /^\*\*(.+)\*\*$/.exec(l);
        return h
          ? { type: 'TextBlock', text: h[1], weight: 'Bolder', wrap: true, spacing: 'Medium' }
          : { type: 'TextBlock', text: l, wrap: true, spacing: 'Small' };
      }),
    ],
  };
  if (actions.length) card.actions = actions;
  return card;
}

/**
 * Per-recipient channels for the Flow (2026-09-28). Teams only inside
 * teamsDomains (Flow bot is tenant-bound); email, when enabled, to everyone —
 * the flow sends it from the shared mailbox. Recipients with neither channel
 * are returned as `skipped` (same as before email existed).
 */
function planFlowDeliveries(to, teamsDomains, emailEnabled) {
  const { send } = splitTeamsRecipients(to, teamsDomains);
  const inTeams = new Set(send);
  const deliveries = [];
  const skipped = [];
  to.forEach((recipient) => {
    const d = { recipient, teams: inTeams.has(recipient), email: !!emailEnabled };
    if (d.teams || d.email) deliveries.push(d); else skipped.push(recipient);
  });
  return { deliveries, skipped };
}

/** Split recipients into those Teams can reach and those it can't. */
function splitTeamsRecipients(to, domains) {
  const ok = new Set((domains || []).map((d) => d.toLowerCase()));
  const send = [];
  const skipped = [];
  to.forEach((e) => (ok.has(String(e).toLowerCase().split('@')[1] || '') ? send : skipped).push(e));
  return { send, skipped };
}

async function sendViaTeamsFlow({ deliveries, subject, title, html, link, endpoint, cardLines, ctaLabel, names = {} }) {
  const url = process.env.TEAMS_FLOW_URL;
  if (!url) throw new Error('TEAMS_FLOW_URL secret is not set');
  const cardJson = JSON.stringify(buildTeamsCard({ subject, title, cardLines, link, endpoint, ctaLabel }));
  const results = [];
  for (const { recipient, teams, email } of deliveries) {
    try {
      const who = names[String(recipient).toLowerCase()] || '';
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // teams/email tell the Flow which branch to run for this person.
        // {{name}} is filled per recipient (greeting).
        body: JSON.stringify({
          recipient, subject, teams, email,
          card: JSON.parse(personalize(cardJson, who, { json: true })),
          html: email ? personalize(html, who) : '',
        }),
      });
      results.push({ email: recipient, http: r.status, viaTeams: teams, viaEmail: email });
    } catch (e) {
      results.push({ email: recipient, http: 0, viaTeams: teams, viaEmail: email, error: String(e?.message || e).slice(0, 200) });
    }
  }
  return results;
}

/**
 * Send one notification. Returns a result object that is ALWAYS written to
 * /mailLog, including for dry runs and failures — the log is the audit trail
 * and the thing verification reads.
 */
async function sendMail(db, { to, subject, text, html, title, link, endpoint, cardLines, ctaLabel, names = {} }) {
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
      const who = finalTo.length === 1 ? (names[finalTo[0].toLowerCase()] || '') : '';
      const r = await sendViaGmailOAuth({ ...cfg, to: finalTo, subject, text: String(text).split(NAME_TOKEN).join(salutation(who)), html: personalize(html, who) });
      return { status: 'sent', provider: cfg.provider, to: finalTo, heldFrom: held, subject, messageId: r.id || '' };
    }
    if (cfg.provider === 'teams-flow') {
      const { deliveries, skipped } = planFlowDeliveries(finalTo, cfg.teamsDomains, cfg.emailEnabled);
      if (!deliveries.length) {
        return { status: 'skipped-domain', provider: cfg.provider, to: finalTo, skippedDomain: skipped, heldFrom: held, subject };
      }
      const teams = await sendViaTeamsFlow({ deliveries, subject, title, html, link, endpoint, cardLines, ctaLabel, names });
      const allOk = teams.every((x) => x.http >= 200 && x.http < 300);
      return { status: allOk ? 'sent' : 'error', provider: cfg.provider, to: deliveries.map((d) => d.recipient), skippedDomain: skipped, heldFrom: held, subject, teams };
    }
    // smtp-relay / resend are declared in PROVIDERS so the config can be set
    // ahead of time, but are not implemented yet — fail loudly rather than
    // silently pretending to have sent.
    return { status: 'error', provider: cfg.provider, to: finalTo, subject, error: `provider "${cfg.provider}" is not implemented yet` };
  } catch (e) {
    return { status: 'error', provider: cfg.provider, to: finalTo, subject, error: String(e?.message || e).slice(0, 500) };
  }
}

module.exports = { PROVIDERS, DEFAULT_CONFIG, loadConfig, buildRawMessage, sendMail, buildTeamsCard, splitTeamsRecipients, planFlowDeliveries };
