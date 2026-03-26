"use client";
import { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  role: 'user' | 'ai';
  text: string;
  streaming?: boolean;
}

interface Props {
  symbol: string;
  context?: string;
}

export default function AiChatPanel({ symbol, context }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear conversation on symbol change
  useEffect(() => {
    setMessages([]);
    setInput('');
    setLoading(false);
    setError(null);
  }, [symbol]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = useCallback(async (questionOverride?: string) => {
    const q = (questionOverride || input).trim();
    if (!q || loading) return;
    setInput('');
    setError(null);

    // Add user message
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setLoading(true);

    // Cancel any previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Build history for multi-turn
    const history = messages.map(m => ({ role: m.role, text: m.text }));

    try {
      // Try streaming first
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          symbol,
          context,
          history,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // If streaming fails, fall back to non-streaming
        const fallbackRes = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, symbol, context, history }),
          signal: controller.signal,
        });
        const data = await fallbackRes.json();
        const answer = data.answer || data.error || 'No response';
        setMessages(prev => [...prev, { role: 'ai', text: answer }]);
        setLoading(false);
        return;
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        // Streaming response
        setMessages(prev => [...prev, { role: 'ai', text: '', streaming: true }]);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.error) {
                  setError(parsed.error);
                  break;
                }
                if (parsed.chunk) {
                  fullText += parsed.chunk;
                  setMessages(prev => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0 && updated[lastIdx].streaming) {
                      updated[lastIdx] = { role: 'ai', text: fullText, streaming: true };
                    }
                    return updated;
                  });
                }
                if (parsed.done) {
                  setMessages(prev => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0 && updated[lastIdx].streaming) {
                      updated[lastIdx] = { role: 'ai', text: fullText || parsed.fullText || 'No response', streaming: false };
                    }
                    return updated;
                  });
                }
              } catch {}
            }
          }
        }
      } else {
        // JSON response (non-streaming fallback)
        const data = await res.json();
        const answer = data.answer || data.error || 'No response';
        setMessages(prev => [...prev, { role: 'ai', text: answer }]);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setMessages(prev => [...prev, { role: 'ai', text: 'Failed to reach AI service. Check your GEMINI_API_KEY in .env.local' }]);
    }
    setLoading(false);
  }, [input, loading, messages, symbol, context]);

  const presets = [
    `What's the near-term outlook for ${symbol}?`,
    `Key risks and catalysts for ${symbol}?`,
    `How does ${symbol} compare to sector peers?`,
    `Break down ${symbol}'s recent earnings performance`,
    `What's the institutional sentiment on ${symbol}?`,
  ];

  // Render markdown-lite formatting
  function renderText(text: string) {
    // Bold
    let formatted = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Bullet points
    formatted = formatted.replace(/^[-•]\s+/gm, '• ');
    // Numbered lists
    formatted = formatted.replace(/^\d+\.\s+/gm, (match) => match);
    return <span dangerouslySetInnerHTML={{ __html: formatted }} />;
  }

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <h2>AI Research Assistant</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ai-chat-badge">Gemini</span>
          {messages.length > 0 && (
            <button
              className="ai-chat-clear"
              onClick={() => { setMessages([]); setError(null); }}
              title="Clear conversation"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="ai-chat-messages" ref={listRef}>
        {messages.length === 0 && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>
              Ask anything about {symbol} — I have multi-turn context:
            </span>
            {presets.map((p) => (
              <button
                key={p}
                className="pred-ask-preset"
                onClick={() => handleSend(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-msg ${msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-ai'}${msg.streaming ? ' ai-msg-streaming' : ''}`}>
            {msg.role === 'ai' ? renderText(msg.text) : msg.text}
            {msg.streaming && <span className="ai-cursor" />}
          </div>
        ))}
        {loading && messages.length > 0 && !messages[messages.length - 1]?.streaming && (
          <div className="ai-msg-loading">
            <div className="range-spinner" />
            Analyzing...
          </div>
        )}
        {error && (
          <div className="ai-msg-error">{error}</div>
        )}
      </div>
      <form
        className="ai-chat-input-row"
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${symbol}...`}
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? '...' : 'Ask'}
        </button>
      </form>
    </div>
  );
}
