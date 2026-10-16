// Server side of every AI call. The browser never sees the Claude API key:
// it sends a prompt plus the student's sign-in token, and this handler checks
// who they are, counts the call against their daily allowance, then asks Claude.
import Anthropic from '@anthropic-ai/sdk';

const KINDS = ['lesson', 'mark', 'other'];
const EFFORT = { quick: 'low', default: 'medium', complex: 'high' };
const MAX_PROMPT_BYTES = 256 * 1024;
const MAX_IMAGES = 5;
const MAX_IMAGE_B64 = 7 * 1024 * 1024; // about 5 MB of image
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function dailyLimits(env = process.env) {
  return { lesson: +env.DAILY_LESSONS || 3, mark: +env.DAILY_MARKS || 20, other: +env.DAILY_OTHER || 30 };
}

// Pull the first JSON object out of the reply, tolerating a stray code fence.
export function parseJSON(text) {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return undefined;
}

function fail(res, status, code, error) { res.status(status).json({ code, error }); }

export function makeHandler({ anthropic, supabaseAdmin, env = process.env }) {
  const limits = dailyLimits(env);
  const model = env.CLAUDE_MODEL || 'claude-opus-5-5';
  return async function handler(req, res) {
    if (req.method !== 'POST') return fail(res, 405, 'method', 'Use POST.');
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return fail(res, 401, 'signed_out', 'Sign in to use the AI tutor.');
    const { data: auth, error: authErr } = await supabaseAdmin.auth.getUser(token);
    const user = auth?.user;
    if (authErr || !user) return fail(res, 401, 'signed_out', 'Your sign-in has expired. Sign in again.');

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { prompt, tier = 'default', kind = 'other', json = false, images = [] } = body;
    if (typeof prompt !== 'string' || !prompt.trim()) return fail(res, 400, 'bad_request', 'Missing prompt.');
    if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) return fail(res, 413, 'prompt_too_large', 'That was too much text to send at once. Try fewer or smaller files.');
    if (!KINDS.includes(kind) || !EFFORT[tier]) return fail(res, 400, 'bad_request', 'Unknown request type.');
    if (!Array.isArray(images) || images.length > MAX_IMAGES || images.some(i => !IMAGE_TYPES.includes(i?.media_type) || typeof i.data !== 'string' || i.data.length > MAX_IMAGE_B64))
      return fail(res, 400, 'bad_images', `Send at most ${MAX_IMAGES} JPEG, PNG, GIF or WebP images of about 5 MB each.`);

    // Count the call before spending money on it. bump_usage is atomic and refuses past the limit.
    const { data: allowed, error: usageErr } = await supabaseAdmin.rpc('bump_usage', { p_user: user.id, p_kind: kind, p_limit: limits[kind] });
    if (usageErr) return fail(res, 500, 'usage_error', 'Could not check your daily allowance. Try again.');
    if (!allowed) {
      const what = { lesson: `${limits.lesson} new lessons, paths or exams`, mark: `${limits.mark} markings and explanations`, other: `${limits.other} other AI requests` }[kind];
      return fail(res, 429, 'daily_limit', `You've used today's ${what}. They reset at midnight (UTC).`);
    }

    const content = [
      ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })),
      { type: 'text', text: json ? prompt + '\n\nReply with the JSON object only, no other text.' : prompt },
    ];
    let msg;
    try {
      msg = await anthropic.beta.messages.create({
        model,
        max_tokens: 16000,
        output_config: { effort: EFFORT[tier] },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [{ role: 'user', content }],
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return fail(res, 503, 'busy', 'The AI tutor is busy. Wait a minute, then try again.');
      if (e instanceof Anthropic.BadRequestError) return fail(res, 400, 'ai_bad_request', 'The AI could not handle that request. Try a smaller file or fewer images.');
      if (e instanceof Anthropic.AuthenticationError) return fail(res, 500, 'ai_config', 'The AI tutor is not set up correctly. Tell the site owner.');
      if (e instanceof Anthropic.APIError) return fail(res, 502, 'ai_error', 'The AI tutor had a problem. Try again.');
      return fail(res, 502, 'ai_error', 'Could not reach the AI tutor. Try again.');
    }
    if (msg.stop_reason === 'refusal') return fail(res, 422, 'refused', 'The AI tutor declined this request. Try rewording it.');
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const truncated = msg.stop_reason === 'max_tokens';
    if (!json) return res.status(200).json({ text, truncated });
    const value = parseJSON(text);
    if (value === undefined || value === null || typeof value !== 'object') return fail(res, 502, 'invalid_json', 'The AI sent back something the app could not read. Try again.');
    return res.status(200).json({ value, truncated });
  };
}
