import { getReport, saveReport } from "@/lib/db";

export async function GET() {
  try {
    return Response.json(getReport());
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { content, meta } = await request.json();
    saveReport(content, meta);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
