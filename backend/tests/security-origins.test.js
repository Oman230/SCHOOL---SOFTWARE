const assert = require('node:assert/strict');
const test = require('node:test');
const { isDevelopmentLanOrigin } = require('../security/origins');

test('development LAN origin check accepts private IPv4 origins with ports', () => {
  assert.equal(isDevelopmentLanOrigin('http://172.20.10.2:5002', 'development'), true);
  assert.equal(isDevelopmentLanOrigin('http://192.168.1.50:3000', 'development'), true);
  assert.equal(isDevelopmentLanOrigin('http://10.0.0.20:5000', 'development'), true);
});

test('development LAN origin check rejects public, malformed, and production origins', () => {
  assert.equal(isDevelopmentLanOrigin('http://8.8.8.8:5002', 'development'), false);
  assert.equal(isDevelopmentLanOrigin('http://172.32.0.1:5002', 'development'), false);
  assert.equal(isDevelopmentLanOrigin('http://192.168.1.50', 'development'), false);
  assert.equal(isDevelopmentLanOrigin('not-an-origin', 'development'), false);
  assert.equal(isDevelopmentLanOrigin('http://172.20.10.2:5002', 'production'), false);
});