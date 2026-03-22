"use client";
import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

interface Props {
  symbol: string;
  context?: string;
}

export default function AiChatPanel({ symbol, context }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleSend() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setLoading(true);

    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, symbol, context }),
      });
      const data = await res.json();
      const answer = data.answer || data.error || 'No response';
      setMessages((prev) => [...prev, { role: 'ai', text: answer }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'ai', text: 'Failed to reach AI service.' }]);
    }
    setLoading(false);
  }

  const presets = [
    `What's the outlook for ${symbol}?`,
    `Key risks for ${symbol} right now?`,
    `Compare ${symbol} to its sector peers`,
  ];

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <h2>AI Assistant</h2>
        <span className="ai-chat-badge">Gemini</span>
      </div>
      <div className="ai-chat-messages" ref={listRef}>
        {messages.length === 0 && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>Ask anything about {symbol}:</span>
            {presets.map((p) => (
              <button
                key={p}
                className="pred-ask-preset"
                onClick={() => { setInput(p); }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-msg ${msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-ai'}`}>
            {msg.text}
          </div>
        ))}
        {loading && (
          <div className="ai-msg-loading">
            <div className="range-spinner" />
            Thinking...
          </div>
        )}
      </div>
      <form
        className="ai-chat-input-row"
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${symbol}...`}
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
