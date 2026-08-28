/**
 * A stand-in for OpenRouter, so the provider can be exercised with no key.
 *
 * It answers 429 twice — with a `retry-after` — and then streams a short
 * OpenAI-style SSE reply. That sequence is the whole point: the bounded backoff
 * in `openrouter.ts` is the part most likely to be wrong and the part hardest to
 * see, because reproducing it against the real endpoint means either spending a
 * credential or waiting to be rate-limited for real.
 *
 *   node scripts/stub-openrouter.mjs &
 *   OPENROUTER_API_KEY=stub \
 *   OPENROUTER_BASE_URL=http://127.0.0.1:8899/v1/chat/completions \
 *   MC_MODE=openrouter npm run dev:gateway
 *
 * `POST /v1/chat/completions` with `stream:false` gets a JSON body instead, so
 * the structured path (`extract`, `infer`, `summary`) can be checked too.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8899);
let hits = 0;

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    hits += 1;

    // Two rate limits, then service. `retry-after: 1` keeps the test quick
    // while still going through the real wait-then-retry path.
    if (hits <= 2) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ error: { message: 'Rate limited by the stub' } }));
      return;
    }

    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* An unparseable body still gets an answer; the provider is what is under test. */
    }

    if (body.stream === false) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ stub: true, model: body.model }) } }],
        }),
      );
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"the retry"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":" worked"}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`stub openrouter on http://127.0.0.1:${PORT} — 429 twice, then answers`);
});
