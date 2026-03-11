import { getAllHoldings, upsertHolding, deleteHolding } from "@/lib/db";

function g(request) { return new URL(request.url).searchParams.get("group") || "thematic"; }

export async function GET(request) {
  try { return Response.json({ holdings: await getAllHoldings(g(request)) }); }
  catch (e) { return Response.json({ holdings: [], error: e.message }, { status: 500 }); }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const group = body.group || g(request);
    if (body.holdings) { for (const h of body.holdings) await upsertHolding(h, group); return Response.json({ ok: true, count: body.holdings.length }); }
    else { await upsertHolding(body, group); return Response.json({ ok: true }); }
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
}

export async function DELETE(request) {
  try { const { id, group } = await request.json(); await deleteHolding(id, group || "thematic"); return Response.json({ ok: true }); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
}