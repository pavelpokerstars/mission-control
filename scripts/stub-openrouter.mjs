// Stub OpenRouter: 429 twice (with retry-after), then a streamed success.
// Used to verify the gateway's bounded retry without spending the shared key.
import { createServer } from 'node:http';

let hits = 0;
createServer((req, res) => {
  hits += 1;
  if (hits <= 2) {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
    res.end(JSON.stringify({ error: { message: 'Rate limited' } }));
    return;
  }
  // Success: a short OpenAI-style SSE stream.
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write('data: {"choices":[{"delta":{"content":"retry"}}]}\n\n');
  res.write('data: {"choices":[{"delta":{"content":" worked"}}]}\n\n');
  res.end('data: [DONE]\n\n');
}).listen(8899, () => console.log('stub openrouter on :8899'));
