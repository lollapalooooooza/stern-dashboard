import { createClient } from "@libsql/client";
import crypto from "crypto";

let _client = null;
function getClient() {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL || "file:stern_local.db",
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
  }
  return _client;
}

let _inited = false;
async function init() {
  if (_inited) return;
  const db = getClient();
  await db.execute(
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      page TEXT NOT NULL DEFAULT 'overview',
      grp TEXT NOT NULL DEFAULT 'thematic',
      username TEXT NOT NULL DEFAULT 'Anonymous',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  // Migrate old catalyst_comments if they exist
  try {
    const old = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='catalyst_comments'`);
    if (old.rows.length > 0) {
      await db.execute(`INSERT OR IGNORE INTO comments (id, page, grp, username, content, created_at, updated_at)
        SELECT id, 'catalyst', 'thematic', author, content, created_at, updated_at
        FROM catalyst_comments WHERE status = 'active'`);
    }
  } catch {}
  _inited = true;
}

// GET — fetch comments for a specific page + group
export async function GET(request) {
  try {
    await init();
    const { searchParams } = new URL(request.url);
    const page = searchParams.get("page") || "overview";
    const group = searchParams.get("group") || "thematic";

    const db = getClient();
    const result = await db.execute({
      sql: `SELECT id, page, grp, username, content, created_at, updated_at
            FROM comments WHERE page = ? AND grp = ?
            ORDER BY created_at DESC`,
      args: [page, group],
    });

    return Response.json({ success: true, comments: result.rows || [] });
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}

// POST — create a new comment
export async function POST(request) {
  try {
    await init();
    const db = getClient();
    const body = await request.json();
    const { page = "overview", group = "thematic", username = "Anonymous", content } = body;

    if (!content || content.trim() === "") {
      return Response.json({ success: false, error: "Content is required" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const trimmedUser = (username || "Anonymous").trim() || "Anonymous";

    await db.execute({
      sql: `INSERT INTO comments (id, page, grp, username, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, page, group, trimmedUser, content.trim(), now, now],
    });

    return Response.json({
      success: true,
      comment: { id, page, grp: group, username: trimmedUser, content: content.trim(), created_at: now, updated_at: now },
    }, { status: 201 });
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}

// PUT — update a comment
export async function PUT(request) {
  try {
    await init();
    const db = getClient();
    const { id, content } = await request.json();

    if (!id) return Response.json({ success: false, error: "Comment ID required" }, { status: 400 });
    if (!content || content.trim() === "") return Response.json({ success: false, error: "Content required" }, { status: 400 });

    const now = new Date().toISOString();
    const result = await db.execute({
      sql: `UPDATE comments SET content = ?, updated_at = ? WHERE id = ?`,
      args: [content.trim(), now, id],
    });

    if (result.rowsAffected === 0) {
      return Response.json({ success: false, error: "Comment not found" }, { status: 404 });
    }

    return Response.json({ success: true, comment: { id, content: content.trim(), updated_at: now } });
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}

// DELETE — delete a comment
export async function DELETE(request) {
  try {
    await init();
    const db = getClient();
    const { id } = await request.json();

    if (!id) return Response.json({ success: false, error: "Comment ID required" }, { status: 400 });

    const result = await db.execute({ sql: `DELETE FROM comments WHERE id = ?`, args: [id] });

    if (result.rowsAffected === 0) {
      return Response.json({ success: false, error: "Comment not found" }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
