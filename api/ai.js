import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { makeHandler } from '../lib/ai-handler.js';

let handler;
export default async function (req, res) {
  const missing = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !process.env[k]);
  if (missing.length) return res.status(500).json({ code: 'ai_config', error: 'The AI tutor is not set up yet. Tell the site owner.' });
  handler ??= makeHandler({
    anthropic: new Anthropic(), // reads ANTHROPIC_API_KEY
    supabaseAdmin: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
  });
  return handler(req, res);
}
