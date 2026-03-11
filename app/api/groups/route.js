import { GROUPS } from "@/lib/db";

export async function GET() {
  return Response.json({ groups: GROUPS });
}
