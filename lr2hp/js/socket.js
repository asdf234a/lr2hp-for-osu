// Minimal auto-reconnecting websocket wrapper.

export function connect(url, { onMessage, onOpen, onClose } = {}) {
    let ws = null;
    let closed = false;

    const open = () => {
        ws = new WebSocket(url);
        ws.onopen = () => onOpen?.(ws);
        ws.onmessage = (ev) => {
            let data;
            try {
                data = JSON.parse(ev.data);
            } catch {
                return;
            }
            onMessage?.(data, ws);
        };
        ws.onclose = () => {
            onClose?.();
            if (!closed) setTimeout(open, 1000);
        };
        ws.onerror = () => ws.close();
    };
    open();

    return {
        send(text) {
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
        },
        close() {
            closed = true;
            ws?.close();
        },
    };
}
