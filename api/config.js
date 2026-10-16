// Public settings the browser needs. The anon key is safe to share: the database's
// row-level security rules decide what each signed-in student can read or write.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '' });
}
