(() => {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const statusLine = document.getElementById('status-line');
  let viewport = { width: 1280, height: 800 };
  let ws;

  function setStatus(text) {
    statusLine.textContent = text;
  }

  function canvasPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = viewport.width / rect.width;
    const scaleY = viewport.height / rect.height;
    return {
      x: Math.max(0, Math.min(viewport.width, (ev.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(viewport.height, (ev.clientY - rect.top) * scaleY)),
    };
  }

  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => setStatus('Live');
    ws.onclose = () => {
      setStatus('Disconnected — reconnecting…');
      setTimeout(connect, 1500);
    };
    ws.onerror = () => setStatus('Connection error');
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'ready' && msg.viewport) {
        viewport = msg.viewport;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setStatus(`Live · ${viewport.width}×${viewport.height}`);
      }
      if (msg.type === 'error') setStatus(msg.error || 'Error');
      if (msg.type === 'frame' && msg.data) {
        if (msg.viewport) viewport = msg.viewport;
        const img = new Image();
        img.onload = () => {
          if (img.width && img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
            viewport = { width: img.width, height: img.height };
          }
          ctx.drawImage(img, 0, 0);
        };
        img.src = `data:image/jpeg;base64,${msg.data}`;
      }
    };
  }

  canvas.addEventListener('mousedown', (ev) => {
    canvas.focus();
    const { x, y } = canvasPoint(ev);
    send({ type: 'mouse', event: 'down', x, y, button: ev.button === 2 ? 'right' : 'left' });
  });
  canvas.addEventListener('mouseup', (ev) => {
    const { x, y } = canvasPoint(ev);
    send({ type: 'mouse', event: 'up', x, y, button: ev.button === 2 ? 'right' : 'left' });
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (ev.buttons === 0 && !ev.ctrlKey) return; // only stream moves while dragging, reduce noise
    const { x, y } = canvasPoint(ev);
    send({ type: 'mouse', event: 'move', x, y });
  });
  // Always send move on pointer for hover targets (throttled)
  let lastMove = 0;
  canvas.addEventListener('pointermove', (ev) => {
    const now = Date.now();
    if (now - lastMove < 32) return;
    lastMove = now;
    const { x, y } = canvasPoint(ev);
    send({ type: 'mouse', event: 'move', x, y });
  });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const { x, y } = canvasPoint(ev);
    send({ type: 'mouse', event: 'wheel', x, y, deltaX: ev.deltaX, deltaY: ev.deltaY });
  }, { passive: false });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  canvas.addEventListener('keydown', (ev) => {
    if (ev.key === 'F5') return;
    ev.preventDefault();
    let modifiers = 0;
    if (ev.altKey) modifiers |= 1;
    if (ev.ctrlKey) modifiers |= 2;
    if (ev.metaKey) modifiers |= 4;
    if (ev.shiftKey) modifiers |= 8;

    if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      send({ type: 'key', event: 'press', text: ev.key, key: ev.key, code: ev.code, modifiers });
      return;
    }
    send({ type: 'key', event: 'down', key: ev.key, code: ev.code, modifiers });
  });
  canvas.addEventListener('keyup', (ev) => {
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) return;
    let modifiers = 0;
    if (ev.altKey) modifiers |= 1;
    if (ev.ctrlKey) modifiers |= 2;
    if (ev.metaKey) modifiers |= 4;
    if (ev.shiftKey) modifiers |= 8;
    send({ type: 'key', event: 'up', key: ev.key, code: ev.code, modifiers });
  });

  document.getElementById('btn-login-x').onclick = async () => {
    await fetch('/api/open-login', { method: 'POST' });
    canvas.focus();
  };
  document.getElementById('btn-home').onclick = () => {
    send({ type: 'navigate', url: 'https://x.com/home' });
  };
  document.getElementById('btn-wipe').onclick = async () => {
    if (!confirm('Wipe the X session on this server? You will need to log in again.')) return;
    await fetch('/api/session-logout', { method: 'POST' });
    location.reload();
  };
  document.getElementById('btn-lock').onclick = async () => {
    await fetch('/api/logout-viewer', { method: 'POST' });
    location.href = '/login';
  };

  connect();
  canvas.focus();
})();
