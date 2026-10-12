'use strict';

function loadPage(contents, url, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, stop = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve();
      if (stop && !contents.isDestroyed()) contents.stop();
    };
    const cancel = () => finish(signal.reason ?? new Error('Carga cancelada.'), true);
    if (signal?.aborted) {
      cancel();
      return;
    }
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(new Error('La página no terminó de cargar en ' + timeoutMs + ' ms.'), true), timeoutMs);
    try {
      // También se observa el rechazo que puede producir stop() después del timeout.
      Promise.resolve(contents.loadURL(url)).then(() => finish(), error => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

module.exports = { loadPage };
