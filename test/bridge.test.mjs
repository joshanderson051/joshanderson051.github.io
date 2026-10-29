// Port Solace old-address bridge: validation and encoding checks (node --test, no deps)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';

const html = readFileSync(new URL('../move/index.html', import.meta.url), 'utf8');
const m = html.match(/<script id="bridge">([\s\S]*?)<\/script>/);
assert.ok(m, 'move/index.html has <script id="bridge">');
const SRC = m[1];

// load the page script with the test flag; withGzip false leaves CompressionStream undefined
function load(withGzip = true) {
  const sandbox = { URL, TextEncoder, btoa, __PS_BRIDGE_TEST__: true };
  if (withGzip) sandbox.CompressionStream = CompressionStream;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.PortSolaceBridge;
}

function fromB64url(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

function decode(payload) {
  if (payload.startsWith('g.')) return JSON.parse(gunzipSync(fromB64url(payload.slice(2))).toString('utf8'));
  if (payload.startsWith('j.')) return JSON.parse(fromB64url(payload.slice(2)).toString('utf8'));
  throw new Error('unknown payload prefix');
}

function fakeStorage(obj) {
  const keys = Object.keys(obj);
  return { get length() { return keys.length; }, key: (i) => keys[i] ?? null, getItem: (k) => (k in obj ? obj[k] : null) };
}

const B = load();

test('allowed destinations', () => {
  const ok = [
    ['https://portsolace.com/play/import.html', 'https://portsolace.com/play/import.html'],
    ['https://www.portsolace.com/play/import.html', 'https://www.portsolace.com/play/import.html'],
    ['https://portsolace.com/play/import.html#old', 'https://portsolace.com/play/import.html'],
    ['https://portsolace.com/play/import.html?x=1', 'https://portsolace.com/play/import.html?x=1'],
    ['http://localhost:8791/waystation/play/import.html', 'http://localhost:8791/waystation/play/import.html'],
    ['http://127.0.0.1:5500/play/import.html', 'http://127.0.0.1:5500/play/import.html'],
  ];
  for (const [to, want] of ok) assert.equal(B.validateTarget(to), want, to);
});

test('rejected destinations', () => {
  const bad = [
    undefined, null, '', 'not a url', '/play/import.html',
    'http://portsolace.com/play/import.html',              // not https
    'https://portsolace.com:8443/play/import.html',        // other port
    'https://evil.portsolace.com/play/import.html',
    'https://portsolace.com.evil.com/play/import.html',
    'https://evilportsolace.com/play/import.html',
    'https://user:pw@portsolace.com/play/import.html',
    'https://portsolace.com/play/',
    'https://portsolace.com/play/import.html/x',
    'https://portsolace.com/play/import.htm',
    'https://joshanderson051.github.io/waystation/play/import.html',
    'http://localhost/play/import.html',                   // no port
    'https://localhost:8791/play/import.html',             // localhost must be http
    'http://localhost.evil.com:80/play/import.html',
    'http://192.168.1.5:8791/play/import.html',
    'javascript:alert(1)//play/import.html',
    'data:text/html,/play/import.html',
  ];
  for (const to of bad) assert.equal(B.validateTarget(to), null, String(to));
});

test('collects only waystation keys, values as strings', () => {
  const keys = B.collectKeys(fakeStorage({ 'waystation.profile.v2': '{"a":1}', 'waystation-save-v1': 'x', 'other': 'no', 'portsolace.profile.v2': 'no', 'Waystation': 'no' }));
  assert.deepEqual({ ...keys }, { 'waystation.profile.v2': '{"a":1}', 'waystation-save-v1': 'x' });
});

test('none path', () => {
  assert.equal(Object.keys(B.collectKeys(fakeStorage({ foo: 'bar' }))).length, 0);
  assert.equal(B.noneUrl('https://portsolace.com/play/import.html'), 'https://portsolace.com/play/import.html#ps-import=none');
});

const sample = { 'waystation.profile.v2': JSON.stringify({ name: 'Kestrel Deep', credits: 1234, note: 'unicode: é中\u{1F680}' }), 'waystation.playerId': 'abc-123' };

test('gzip payload round-trips', async () => {
  const env = B.buildEnvelope(sample, 'https://joshanderson051.github.io', 1700000000000);
  const payload = await B.encodePayload(JSON.stringify(env));
  assert.ok(payload.startsWith('g.'), payload.slice(0, 4));
  assert.match(payload.slice(2), /^[A-Za-z0-9_-]*$/);
  const back = decode(payload);
  assert.equal(back.v, 1);
  assert.equal(back.from, 'https://joshanderson051.github.io');
  assert.equal(back.at, 1700000000000);
  assert.deepEqual(back.keys, sample);
  assert.equal(B.importUrl('https://portsolace.com/play/import.html', payload), 'https://portsolace.com/play/import.html#ps-import=' + payload);
});

test('raw payload round-trips without CompressionStream', async () => {
  const R = load(false);
  const env = R.buildEnvelope(sample, 'https://joshanderson051.github.io', 5);
  const payload = await R.encodePayload(JSON.stringify(env));
  assert.ok(payload.startsWith('j.'));
  assert.match(payload.slice(2), /^[A-Za-z0-9_-]*$/);
  assert.deepEqual(decode(payload), JSON.parse(JSON.stringify(env)));
});

test('large binary-ish payloads encode in chunks', async () => {
  const big = {}; for (let i = 0; i < 50; i++) big['waystation.blob' + i] = Math.random().toString(36).repeat(2000);
  const payload = await B.encodePayload(JSON.stringify(B.buildEnvelope(big, 'o', 1)));
  assert.deepEqual(decode(payload).keys, big);
});

test('size cap', () => {
  assert.equal(B.MAX_PAYLOAD, 1000000);
  assert.equal(B.tooLarge('g.' + 'a'.repeat(1000000 - 2)), false);
  assert.equal(B.tooLarge('g.' + 'a'.repeat(1000000 - 1)), true);
});

test('raw payload over the cap is flagged', async () => {
  const R = load(false);
  const huge = { 'waystation.x': 'z'.repeat(1200000) };
  const payload = await R.encodePayload(JSON.stringify(R.buildEnvelope(huge, 'o', 1)));
  assert.ok(R.tooLarge(payload));
});
