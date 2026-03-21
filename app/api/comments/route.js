import { createClient } from "@libsql/client";
import crypto from "crypto";
function uuidv4() { return crypto.randomUUID(); }

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

const _inited = {};
async function init() {
  if (_inited["comments"]) return;
  const db = getClient();
  const tableName = "catalyst_comments";

  await db.execute(
    `CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL DEFAULT 'Anonymous',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    )`
  );

  _inited["comments"] = true;
}

export async function GET(request) {
  try {
    await init();
    const db = getClient();
    const tableName = "catalyst_comments";

    const result = await db.execute(
      `SELECT id, author, content, created_at, updated_at FROM ${tableName}
       WHERE status = 'active'
       ORDER BY created_at DESC`
    );

    return Response.json({
      success: true,
      comments: result.rows || []
    });
  } catch (e) {
    return Response.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    await init();
    const db = getClient();
    const tableName = "catalyst_comments";
    const body = await request.json();

    const { author = "Anonymous", content } = body;

    if (!content || content.trim() === "") {
      return Response.json(
        { success: false, error: "Content is required" },
        { status: 400 }
      );
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    await db.execute({
      sql: `INSERT INTO ${tableName} (id, author, content, created_at, updated_at, status)
            VALUES (?, ?, ?, ?, ?, 'active')`,
      args: [id, author, content.trim(), now, now]
    });

    return Response.json({
      success: true,
      comment: {
        id,
        author,
        content: content.trim(),
        created_at: now,
        updated_at: now
      }
    }, { status: 201 });
  } catch (e) {
    return Response.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    await init();
    const db = getClient();
    const tableName = "catalyst_comments";
    const body = await request.json();

    const { id, content } = body;

    if (!id) {
      return Response.json(
        { success: false, error: "Comment ID is required" },
        { status: 400 }
      );
    }

    if (!content || content.trim() === "") {
      return Response.json(
        { success: false, error: "Content is required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const result = await db.execute({
      sql: `UPDATE ${tableName}
            SET content = ?, updated_at = ?
            WHERE id = ? AND status = 'active'`,
      args: [content.trim(), now, id]
    });

    if (result.rowsAffected === 0) {
      return Response.json(
        { success: false, error: "Comment not found or already deleted" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      comment: {
        id,
        content: content.trim(),
        updated_at: now
      }
    });
  } catch (e) {
    return Response.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    await init();
    const db = getClient();
    const tableName = "catalyst_comments";
    const body = await request.json();

    const { id } = body;

    if (!id) {
      return Response.json(
        { success: false, error: "Comment ID is required" },
        { status: 400 }
      );
    }

    const result = await db.execute({
      sql: `UPDATE ${tableName}
            SET status = 'deleted', updated_at = ?
            WHERE id = ? AND status = 'active'`,
      args: [new Date().toISOString(), id]
    });

    if (result.rowsAffected === 0) {
      return Response.json(
        { success: false, error: "Comment not found or already deleted" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      message: "Comment deleted successfully"
    });
  } catch (e) {
    return Response.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
