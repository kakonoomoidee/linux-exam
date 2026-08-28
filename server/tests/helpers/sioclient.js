/**
 * Minimal Socket.IO v4 client over raw ws — the repo has no socket.io-client
 * dependency, but `ws` ships with socket.io. Enough for tests: connect to the
 * default namespace, emit events, await events with a timeout.
 */
const WebSocket = require('ws');
const { EventEmitter } = require('node:events');

function connect(baseUrl) {
  const em = new EventEmitter();
  const url = baseUrl.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
  const ws = new WebSocket(url);
  let acked = false;

  ws.on('message', (raw) => {
    const s = raw.toString();
    const type = s[0];
    if (type === '0') return ws.send('40'); // engine.io open -> connect namespace "/"
    if (type === '2') return ws.send('3'); // ping -> pong
    if (s.startsWith('40')) {
      acked = true;
      return em.emit('__connect');
    }
    if (s.startsWith('42')) {
      const [name, payload] = JSON.parse(s.slice(2));
      em.emit(name, payload);
    }
  });
  ws.on('error', (e) => em.emit('__error', e));

  em.emitEvent = (name, payload) => ws.send('42' + JSON.stringify([name, payload]));
  em.close = () => ws.close();
  em.ready = () =>
    new Promise((res, rej) => {
      if (acked) return res();
      em.once('__connect', res);
      em.once('__error', rej);
      setTimeout(() => rej(new Error('socket connect timeout')), 3000);
    });
  return em;
}

/** Resolve with the payload of the next `name` event, or reject on timeout. */
function waitFor(em, name, ms = 3000) {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(`timeout waiting for "${name}"`)), ms);
    em.once(name, (p) => {
      clearTimeout(to);
      res(p);
    });
  });
}

/** Resolve true if `name` fires within ms, false otherwise (assert-a-non-event). */
function neverFires(em, name, ms = 800) {
  return new Promise((res) => {
    const to = setTimeout(() => res(true), ms);
    em.once(name, () => {
      clearTimeout(to);
      res(false);
    });
  });
}

module.exports = { connect, waitFor, neverFires };
