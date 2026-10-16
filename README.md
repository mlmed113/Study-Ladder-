# Study Ladder

Learn any subject from the basics through exam-style questions (MCQ, short answer, essay), with AI marking, coaching and a community for sharing courses. Students sign in with Google and get a private workspace.

## How it fits together

| Part | What it does | Where |
| --- | --- | --- |
| `public/index.html` | The whole app in the browser: uploads, learning path, lessons, coach, community | Vercel (static) |
| `api/ai.js` | Holds the Claude API key, checks the student's sign-in, counts their daily allowance, calls Claude | Vercel function |
| `api/config.js` | Gives the browser the public Supabase address and anon key | Vercel function |
| `supabase/schema.sql` | Tables and privacy rules: each student only reaches their own rows | Supabase |

Uploaded files are read in the browser (PDF, PowerPoint, Word, text; photos and scanned PDFs are read by Claude), and only the extracted text is saved.

## Set it up

### 1. Supabase (database and Google sign-in)
1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor > New query**: paste all of `supabase/schema.sql` and press **Run**.
3. **Authentication > Sign In / Providers > Google**: turn it on. It asks for a Google *Client ID* and *Client secret*:
   - In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create a project, then **Create credentials > OAuth client ID > Web application**.
   - Under *Authorized redirect URIs*, paste the callback URL Supabase shows on the Google provider page.
   - Copy the client ID and secret back into Supabase and save.
4. **Authentication > URL Configuration**: set *Site URL* to your Vercel address (for example `https://study-ladder.vercel.app`) and add it under *Redirect URLs*.
5. **Project Settings > API**: note the *Project URL*, the *anon public* key and the *service_role* key. The service_role key is secret.

### 2. Anthropic (the AI)
1. At [console.anthropic.com](https://console.anthropic.com), add billing and a small credit.
2. **Limits**: set a monthly spend limit.
3. **API keys**: create a key. It is secret.

### 3. Vercel (hosting)
1. Import this GitHub repository at [vercel.com/new](https://vercel.com/new). No build settings are needed.
2. **Settings > Environment Variables**, add:

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `DAILY_LESSONS` (optional) | new lessons, paths and practice exams per student per day, default 3 |
| `DAILY_MARKS` (optional) | markings and explanations per day, default 20 |
| `DAILY_OTHER` (optional) | other AI requests (exam analysis, photo reading, coach) per day, default 30 |
| `CLAUDE_MODEL` (optional) | default `claude-opus-5-5` |

3. Redeploy so the variables take effect.

### 4. Make yourself admin
Sign in to the site once. Then in Supabase **SQL Editor** run:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'YOUR-GMAIL@gmail.com';
```

Admins can remove any community course and read reports (`select * from public.reports`).

## Costs and safety
- Every AI call goes through `api/ai.js`, which refuses signed-out callers and stops a student at their daily allowance before spending anything.
- The Claude request uses Opus 5.5 with server-side refusal fallback turned on (`fallbacks: "default"`), so a request one model declines can be answered by another.
- Row-level security keeps each student's courses, materials, lessons and answers private. Shared community courses contain only the title, learning path and exam format.

## Run it locally
```bash
npm install
cp .env.example .env   # fill in the values
npm run dev            # http://localhost:3000
npm test               # server tests
```
Add `http://localhost:3000` to Supabase's Redirect URLs to sign in locally.
