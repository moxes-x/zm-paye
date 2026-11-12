// Serves the built API bundle (api/index.js) on plain Node, the same runtime Vercel uses.
// Usage: npm run api:local, then open http://localhost:8787/v1/take-home?gross=10000
import { createServer } from 'node:http';
import api from '../api/index.js';

const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });
  const response = await api.fetch(request);

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`API on http://localhost:${port}/v1`));
