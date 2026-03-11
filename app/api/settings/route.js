import { getSettings, saveSettings } from "@/lib/db";

export async function GET() {
  try {
    return Response.json({ settings: getSettings() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { settings } = await request.json();
    saveSettings(settings);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
