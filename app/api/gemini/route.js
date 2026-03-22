import { NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AlzaSyCkwKSsu5Y70oYwЕ0vСOjaZA2WqKSPemA0';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function POST(request) {
  try {
    const { question, context, symbol } = await request.json();
    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    const systemPrompt = `You are a professional financial analyst AI assistant. You specialize in stock market analysis, investment research, and financial news interpretation. You provide smart, concise, and professional responses.

${context ? `Context about ${symbol || 'the stock'}:\n${context}\n` : ''}
Respond in a professional but accessible tone. Be specific with data when available. Keep answers focused and actionable.`;

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              { text: question }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          topP: 0.9,
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);
      return NextResponse.json({ error: `Gemini API error: ${response.status}` }, { status: 502 });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';

    return NextResponse.json({ answer: text });
  } catch (e) {
    console.error('Gemini route error:', e);
    return NextResponse.json({ error: 'Failed to get AI response' }, { status: 500 });
  }
}
