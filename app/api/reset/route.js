import { resetDatabase } from "@/lib/db";

export async function POST() {
  try {
    resetDatabase();
    return Response.json({ ok: true, message: "Database reset to defaults" });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
