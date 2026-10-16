// Local preview: `npm install`, copy .env.example to .env and fill it in, then `npm run dev`.
// Serves public/ and runs the same api/ functions Vercel runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = +process.env.PORT || 3000;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); return res; };
  const api = url.pathname.match(/^\/api\/([a-z]+)$/);
  if (api && fs.existsSync(`api/${api[1]}.js`)) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    req.body = raw ? JSON.parse(raw) : {};
    const mod = await import(`./api/${api[1]}.js`);
    try { await mod.default(req, res); } catch (e) { console.error(e); res.status(500).json({ code: 'server', error: 'Server error' }); }
    return;
  }
  const file = path.join('public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith('public') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Study Ladder running at http://localhost:${port}`));
