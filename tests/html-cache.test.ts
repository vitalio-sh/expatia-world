import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/server/worker';

test('page HTML is never retained as an old application while hashed assets remain cacheable', async () => {
  for (const pathname of ['/', '/index.html']) {
    const response = await worker.fetch(new Request('https://expatia.world' + pathname), {
      ASSETS: { fetch: async () => new Response('<html>current application</html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } }) },
    });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
    assert.equal(await response.text(), '<html>current application</html>');
  }
  const asset = await worker.fetch(new Request('https://expatia.world/assets/application-hash.js'), {
    ASSETS: { fetch: async () => new Response('current bundle', { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' } }) },
  });
  assert.equal(asset.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
});
