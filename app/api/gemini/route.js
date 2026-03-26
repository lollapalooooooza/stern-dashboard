import { NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;

// In-memory conversation cache per symbol (last 10 messages)
const conversationCache = new Map();
const MAX_HISTORY = 10;
const CACHE_CLEANUP_INTERVAL = 600_000; // 10 min
let lastCleanup = Date.now();

function getHistory(symbol) {
  return conversationCache.get(symbol) || [];
}

function addToHistory(symbol, role, text) {
  const history = getHistory(symbol);
  history.push({ role, text, ts: Date.now() });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversationCache.set(symbol, history);
  // Periodic cleanup of old conversations
  if (Date.now() - lastCleanup > CACHE_CLEANUP_INTERVAL) {
    lastCleanup = Date.now();
    for (const [key, val] of conversationCache) {
      if (val.length > 0 && Date.now() - val[val.length - 1].ts > 3600_000) {
        conversationCache.delete(key);
      }
    }
  }
}

// ─── Standard (non-streaming) endpoint ───
export async function POST(request) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured. Add it to .env.local' }, { status: 503 });
    }

    const { question, context, symbol, history: clientHistory, stream } = await request.json();
    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    const systemPrompt = buildSystemPrompt(symbol, context);

    // Build conversation contents
    const contents = [];

    // Add conversation history for multi-turn context
    const serverHistory = getHistory(symbol);
    const historyToUse = clientHistory || serverHistory;
    if (historyToUse && historyToUse.length > 0) {
      for (const msg of historyToUse.slice(-6)) {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }],
        });
      }
    }

    // Add current question
    contents.push({
      role: 'user',
      parts: [{ text: question }],
    });

    // ─── Streaming response ───
    if (stream) {
      const streamUrl = `${GEMINI_API_URL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

      const geminiRes = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 3072,
            topP: 0.9,
          },
        }),
      });

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error('Gemini stream error:', geminiRes.status, errText);
        return NextResponse.json({ error: `Gemini API error: ${geminiRes.status}` }, { status: 502 });
      }

      // Transform Gemini SSE stream into our own SSE stream
      const encoder = new TextEncoder();
      let fullText = '';

      const readable = new ReadableStream({
        async start(controller) {
          const reader = geminiRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              // Parse SSE events
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const jsonStr = line.slice(6).trim();
                  if (!jsonStr || jsonStr === '[DONE]') continue;
                  try {
                    const parsed = JSON.parse(jsonStr);
                    const chunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (chunk) {
                      fullText += chunk;
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk, done: false })}\n\n`));
                    }
                  } catch {}
                }
              }
            }

            // Save to conversation history
            addToHistory(symbol, 'user', question);
            addToHistory(symbol, 'ai', fullText);

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: '', done: true, fullText })}\n\n`));
            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // ─── Standard (non-streaming) response ───
    const response = await fetch(`${GEMINI_API_URL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 3072,
          topP: 0.9,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);
      return NextResponse.json({ error: `Gemini API error: ${response.status}` }, { status: 502 });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';

    // Save to conversation history
    addToHistory(symbol, 'user', question);
    addToHistory(symbol, 'ai', text);

    return NextResponse.json({ answer: text });
  } catch (e) {
    console.error('Gemini route error:', e);
    return NextResponse.json({ error: 'Failed to get AI response' }, { status: 500 });
  }
}

function buildSystemPrompt(symbol, context) {
  return `You are a senior financial analyst AI embedded in a professional portfolio research terminal called "Catalyst" at NYU Stern MIF.

Your role:
- Provide actionable, data-driven stock analysis
- Be specific with numbers, dates, and catalysts
- Structure responses clearly with bullet points when appropriate
- When discussing price movements, mention specific percentage changes and timeframes
- Consider both bull and bear cases
- Reference recent earnings, macro trends, sector dynamics, and competitive positioning
- Be concise but thorough — aim for 150-300 words unless asked for deep analysis
- Use markdown formatting: **bold** for key points, bullet lists for factors
- When you don't have real-time data, clearly state your knowledge cutoff and focus on structural analysis

${context ? `\nCurrent context about ${symbol || 'the stock'}:\n${context}\n` : ''}
${symbol ? `\nYou are analyzing: ${symbol}. Focus your responses on this ticker unless asked about broader topics.` : ''}

Response style: Professional, confident, specific. Think like a sell-side analyst writing a quick note, not a chatbot giving generic advice.`;
}
