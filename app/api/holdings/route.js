import { getAllHoldings, upsertHolding, deleteHolding } from "@/lib/db";

export async function GET() {
  try {
    const holdings = getAllHoldings();
    return Response.json({ holdings });
  } catch (e) {
    return Response.json({ holdings: [], error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (body.holdings) {
      // Bulk save all holdings
      for (const h of body.holdings) upsertHolding(h);
      return Response.json({ ok: true, count: body.holdings.length });
    } else {
      // Single holding
      upsertHolding(body);
      return Response.json({ ok: true });
    }
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const h = await request.json();
    upsertHolding(h);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json();
    deleteHolding(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
