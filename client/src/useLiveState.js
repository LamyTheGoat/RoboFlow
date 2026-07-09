import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Live factory state over WebSocket, with auto-reconnect and an initial REST
// fetch so the UI renders even if the socket takes a moment.
export function useLiveState() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    let ws;
    let closed = false;
    let timer;

    api.fetchState().then((s) => setState((prev) => prev ?? s)).catch(() => {});

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry.current = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') setState(msg.state);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) {
          timer = setTimeout(connect, Math.min(10000, 500 * 2 ** retry.current++));
        }
      };
      ws.onerror = () => ws.close();
    }
    connect();

    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { state, connected };
}
