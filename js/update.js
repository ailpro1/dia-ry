/* Keeps an installed copy current.
   When a deploy renames the cache in sw.js, the new worker installs in the
   background; this module swaps it in and reloads as soon as doing so cannot
   interrupt anything. */

import { toast } from './ui.js';

const CHECK_EVERY = 30 * 60 * 1000;  // background poll while the app is open
const CHECK_THROTTLE = 60 * 1000;    // never hammer the server
const RETRY_EVERY = 15 * 1000;       // re-test "is it safe to reload yet?"

let registration = null;
let waitingWorker = null;
let reloading = false;
let hadController = false;
let lastCheck = 0;
let isBusy = () => false;

export function initUpdates({ isBusy: busyFn } = {}) {
  if (busyFn) isBusy = busyFn;
  if (!('serviceWorker' in navigator)) return;

  hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A brand-new install claims the page too; only an actual swap reloads.
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });

  // updateViaCache: 'none' — always byte-check sw.js against the network,
  // otherwise an HTTP-cached worker can hide a deploy for a day.
  navigator.serviceWorker
    .register(new URL('sw.js', document.baseURI).href, { updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;
      watch(reg);
      checkNow();

      document.addEventListener('visibilitychange', () => {
        // iOS keeps a home-screen app suspended for days; reopening it is the
        // moment that matters.
        if (document.visibilityState === 'visible') { checkNow(); applyIfIdle(); }
      });
      window.addEventListener('focus', checkNow);
      setInterval(checkNow, CHECK_EVERY);
      setInterval(applyIfIdle, RETRY_EVERY);
    })
    .catch(() => { /* offline, or no HTTPS — the app still works */ });
}

function watch(reg) {
  if (reg.waiting) queue(reg.waiting);

  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    if (!next) return;
    next.addEventListener('statechange', () => {
      if (next.state === 'installed') queue(next);
    });
  });
}

function queue(worker) {
  if (!navigator.serviceWorker.controller) return; // first install, nothing to swap
  hadController = true;
  waitingWorker = worker;
  applyIfIdle();
}

function applyIfIdle() {
  if (!waitingWorker || reloading) return;
  let busy = false;
  try { busy = isBusy(); } catch (_) { busy = false; }
  if (busy) return;

  const worker = waitingWorker;
  waitingWorker = null;
  toast('updating dia-ry…', 1500);
  worker.postMessage({ type: 'SKIP_WAITING' });
}

/** Ask the server whether sw.js has changed. Throttled. */
export function checkNow(force = false) {
  if (!registration) return Promise.resolve(false);
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_THROTTLE) return Promise.resolve(false);
  lastCheck = now;
  return registration.update().then(() => true).catch(() => false);
}

export function updateReady() {
  return !!waitingWorker;
}

/** The running worker's VERSION, for display in settings. */
export function currentVersion() {
  return new Promise((resolve) => {
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!worker) { resolve(null); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (ev) => {
      clearTimeout(timer);
      resolve((ev.data && ev.data.version) || null);
    };
    try {
      worker.postMessage({ type: 'VERSION' }, [channel.port2]);
    } catch (_) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
