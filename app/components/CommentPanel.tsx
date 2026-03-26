"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, X, Send, Edit3, Trash2, Check, ChevronDown, User } from "lucide-react";

interface Comment {
  id: string;
  page: string;
  grp: string;
  username: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  page: string;
  group: string;
}

const USERNAME_OPTIONS = [
  "Anonymous",
  "Professor",
];

function timeAgo(dateStr: string) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function CommentPanel({ page, group }: Props) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [username, setUsername] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("comment-username") || "Anonymous";
    return "Anonymous";
  });
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [commentCount, setCommentCount] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch comments
  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/comments?page=${page}&group=${group}`);
      const data = await res.json();
      if (data.success) {
        setComments(data.comments || []);
        setCommentCount(data.comments?.length || 0);
      }
    } catch {}
    setLoading(false);
  }, [page, group]);

  // Fetch on open and on page/group change
  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Poll for new comments every 15s when open
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(fetchComments, 15000);
    return () => clearInterval(interval);
  }, [open, fetchComments]);

  // Scroll to bottom on new comment
  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments.length, open]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
    }
    if (showUserDropdown) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showUserDropdown]);

  // Save username preference
  function selectUsername(name: string) {
    setUsername(name);
    setShowUserDropdown(false);
    if (typeof window !== "undefined") localStorage.setItem("comment-username", name);
  }

  // Send comment
  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, group, username, content: text }),
      });
      const data = await res.json();
      if (data.success) {
        setComments(prev => [...prev, data.comment]);
        setCommentCount(prev => prev + 1);
        setInput("");
        setTimeout(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
        }, 50);
      }
    } catch {}
    setSending(false);
  }

  // Edit comment
  async function handleEdit(id: string) {
    const text = editContent.trim();
    if (!text) return;
    try {
      const res = await fetch("/api/comments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, content: text }),
      });
      const data = await res.json();
      if (data.success) {
        setComments(prev => prev.map(c => c.id === id ? { ...c, content: text, updated_at: data.comment.updated_at } : c));
        setEditingId(null);
        setEditContent("");
      }
    } catch {}
  }

  // Delete comment
  async function handleDelete(id: string) {
    try {
      const res = await fetch("/api/comments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        setComments(prev => prev.filter(c => c.id !== id));
        setCommentCount(prev => Math.max(0, prev - 1));
        setDeleteConfirm(null);
      }
    } catch {}
  }

  const isProfessor = (name: string) => name.toLowerCase() === "professor";

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => { setOpen(!open); setDeleteConfirm(null); setEditingId(null); }}
        className="no-print"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: open ? "#475569" : "#1e293b",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          zIndex: 9999,
          transition: "all 0.2s ease",
        }}
        title={open ? "Close comments" : "Open comments"}
      >
        {open ? <X size={22} /> : (
          <div style={{ position: "relative" }}>
            <MessageCircle size={22} />
            {commentCount > 0 && (
              <span style={{
                position: "absolute", top: -8, right: -10,
                background: "#ef4444", color: "#fff",
                fontSize: 10, fontWeight: 700,
                minWidth: 18, height: 18,
                borderRadius: 9,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 4px",
                lineHeight: 1,
              }}>
                {commentCount > 99 ? "99+" : commentCount}
              </span>
            )}
          </div>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          className="no-print"
          style={{
            position: "fixed",
            bottom: 88,
            right: 24,
            width: 380,
            maxHeight: "min(520px, calc(100vh - 120px))",
            background: "#fff",
            borderRadius: 16,
            boxShadow: "0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.05)",
            zIndex: 9998,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: "'DM Sans', system-ui, sans-serif",
            animation: "comment-slide-up 0.2s ease-out",
          }}
        >
          <style>{`
            @keyframes comment-slide-up {
              from { opacity: 0; transform: translateY(12px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .comment-bubble { transition: background 0.15s; }
            .comment-bubble:hover .comment-actions { opacity: 1 !important; }
            .comment-textarea { resize: none; overflow-y: auto; }
            .comment-textarea:focus { outline: none; border-color: #3b82f6; }
            .professor-bubble { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%) !important; border: 1.5px solid #f59e0b !important; }
            .professor-name { color: #92400e; font-weight: 700; }
            .professor-badge { background: #f59e0b; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-left: 4px; }
          `}</style>

          {/* Header */}
          <div style={{
            padding: "14px 18px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Comments</span>
              <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>
                {page.charAt(0).toUpperCase() + page.slice(1)}
              </span>
            </div>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              {commentCount} {commentCount === 1 ? "comment" : "comments"}
            </span>
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minHeight: 0,
            }}
          >
            {loading && comments.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: "#94a3b8", fontSize: 13 }}>
                Loading comments...
              </div>
            ) : comments.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: "#94a3b8", fontSize: 13 }}>
                <MessageCircle size={28} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
                <div>No comments yet</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>Be the first to leave a note</div>
              </div>
            ) : (
              comments.map((c) => {
                const prof = isProfessor(c.username);
                const isEditing = editingId === c.id;
                const isDeleting = deleteConfirm === c.id;
                const edited = c.updated_at !== c.created_at;

                return (
                  <div
                    key={c.id}
                    className={`comment-bubble ${prof ? "professor-bubble" : ""}`}
                    style={{
                      background: prof ? undefined : "#f8fafc",
                      border: prof ? undefined : "1px solid #e2e8f0",
                      borderRadius: 12,
                      padding: "10px 14px",
                      position: "relative",
                    }}
                  >
                    {/* Header row */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span className={prof ? "professor-name" : ""} style={{
                          fontSize: 12, fontWeight: 600,
                          color: prof ? undefined : "#334155",
                        }}>
                          {c.username || "Anonymous"}
                        </span>
                        {prof && <span className="professor-badge">PROF</span>}
                        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 4 }}>
                          {timeAgo(c.created_at)}
                        </span>
                        {edited && <span style={{ fontSize: 9, color: "#94a3b8", fontStyle: "italic" }}>(edited)</span>}
                      </div>

                      {/* Actions */}
                      <div className="comment-actions" style={{ opacity: 0, display: "flex", gap: 2, transition: "opacity 0.15s" }}>
                        {!isEditing && !isDeleting && (
                          <>
                            <button
                              onClick={() => { setEditingId(c.id); setEditContent(c.content); setDeleteConfirm(null); }}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 4, color: "#64748b", display: "flex" }}
                              title="Edit"
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              onClick={() => { setDeleteConfirm(c.id); setEditingId(null); }}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 4, color: "#ef4444", display: "flex" }}
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Content or Edit form */}
                    {isEditing ? (
                      <div style={{ marginTop: 4 }}>
                        <textarea
                          className="comment-textarea"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          style={{
                            width: "100%", fontSize: 13, padding: "8px 10px",
                            borderRadius: 8, border: "1px solid #cbd5e1",
                            fontFamily: "inherit", minHeight: 60,
                            background: "#fff",
                          }}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEdit(c.id); }
                            if (e.key === "Escape") { setEditingId(null); setEditContent(""); }
                          }}
                        />
                        <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                          <button
                            onClick={() => { setEditingId(null); setEditContent(""); }}
                            style={{
                              fontSize: 11, padding: "4px 12px", borderRadius: 6,
                              border: "1px solid #e2e8f0", background: "#fff",
                              color: "#64748b", cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleEdit(c.id)}
                            disabled={!editContent.trim()}
                            style={{
                              fontSize: 11, padding: "4px 12px", borderRadius: 6,
                              border: "none", background: "#1e293b",
                              color: "#fff", cursor: "pointer",
                              opacity: editContent.trim() ? 1 : 0.4,
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : isDeleting ? (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 6 }}>Delete this comment?</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            style={{
                              fontSize: 11, padding: "4px 12px", borderRadius: 6,
                              border: "1px solid #e2e8f0", background: "#fff",
                              color: "#64748b", cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            style={{
                              fontSize: 11, padding: "4px 12px", borderRadius: 6,
                              border: "none", background: "#ef4444",
                              color: "#fff", cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {c.content}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Input area */}
          <div style={{ borderTop: "1px solid #e2e8f0", padding: "10px 14px", flexShrink: 0 }}>
            {/* Username selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, position: "relative" }} ref={dropdownRef}>
              <User size={13} style={{ color: "#94a3b8" }} />
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  fontSize: 11, color: "#475569", background: "#f1f5f9",
                  border: "1px solid #e2e8f0", borderRadius: 6,
                  padding: "3px 10px", cursor: "pointer",
                  fontWeight: isProfessor(username) ? 700 : 500,
                }}
              >
                {username}
                {isProfessor(username) && <span className="professor-badge" style={{ marginLeft: 2 }}>PROF</span>}
                <ChevronDown size={11} />
              </button>

              {/* Custom username input */}
              <input
                type="text"
                placeholder="Custom name..."
                value={USERNAME_OPTIONS.includes(username) ? "" : username}
                onChange={(e) => {
                  const val = e.target.value;
                  setUsername(val || "Anonymous");
                  if (typeof window !== "undefined") localStorage.setItem("comment-username", val || "Anonymous");
                }}
                style={{
                  flex: 1, fontSize: 11, padding: "4px 8px",
                  border: "1px solid #e2e8f0", borderRadius: 6,
                  background: "#f8fafc", color: "#334155",
                  outline: "none",
                }}
                onFocus={() => setShowUserDropdown(false)}
              />

              {/* Dropdown */}
              {showUserDropdown && (
                <div style={{
                  position: "absolute", top: "100%", left: 20, marginTop: 4,
                  background: "#fff", border: "1px solid #e2e8f0",
                  borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  zIndex: 10, overflow: "hidden",
                }}>
                  {USERNAME_OPTIONS.map((name) => (
                    <button
                      key={name}
                      onClick={() => selectUsername(name)}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        width: "100%", padding: "8px 14px",
                        fontSize: 12, border: "none", background: username === name ? "#f1f5f9" : "#fff",
                        cursor: "pointer", color: "#334155",
                        fontWeight: isProfessor(name) ? 700 : 400,
                      }}
                    >
                      {name}
                      {isProfessor(name) && <span className="professor-badge">PROF</span>}
                      {username === name && <Check size={12} style={{ marginLeft: "auto", color: "#3b82f6" }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Message input */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                className="comment-textarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Write a comment..."
                rows={1}
                style={{
                  flex: 1, fontSize: 13, padding: "8px 12px",
                  borderRadius: 10, border: "1px solid #e2e8f0",
                  fontFamily: "inherit", minHeight: 38, maxHeight: 100,
                  background: "#f8fafc",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                onInput={(e) => {
                  const el = e.target as HTMLTextAreaElement;
                  el.style.height = "38px";
                  el.style.height = Math.min(el.scrollHeight, 100) + "px";
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: input.trim() ? "#1e293b" : "#e2e8f0",
                  color: input.trim() ? "#fff" : "#94a3b8",
                  border: "none", cursor: input.trim() ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, transition: "all 0.15s",
                }}
                title="Send comment"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
