import { getWeeklyHistory, saveWeeklyHistory } from "@/lib/db";

export async function GET() {
  try {
    return Response.json({ history: getWeeklyHistory() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { history } = await request.json();
    saveWeeklyHistory(history);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
