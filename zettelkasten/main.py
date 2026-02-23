import os
import json
import sqlite3
from datetime import datetime
from typing import Optional, List, AsyncGenerator
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import anthropic

app = FastAPI(title="Zettelkasten")

client = anthropic.Anthropic()

DB_PATH = os.path.join(os.path.dirname(__file__), "zettelkasten.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS concepts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                label TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (source_id) REFERENCES concepts(id) ON DELETE CASCADE,
                FOREIGN KEY (target_id) REFERENCES concepts(id) ON DELETE CASCADE,
                UNIQUE(source_id, target_id)
            );
        """)
        conn.commit()
    finally:
        conn.close()


init_db()


# ── Pydantic models ──────────────────────────────────────────────────────────

class ConceptCreate(BaseModel):
    title: str
    content: str = ""
    tags: List[str] = []


class ConceptUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[List[str]] = None


class LinkCreate(BaseModel):
    source_id: int
    target_id: int
    label: str = ""


class ChatRequest(BaseModel):
    messages: List[dict]
    include_context: bool = True


# ── Concepts ─────────────────────────────────────────────────────────────────

@app.get("/api/concepts")
def list_concepts():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM concepts ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/concepts", status_code=201)
def create_concept(data: ConceptCreate):
    now = datetime.utcnow().isoformat()
    conn = get_db()
    try:
        cursor = conn.execute(
            "INSERT INTO concepts (title, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (data.title, data.content, json.dumps(data.tags), now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM concepts WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/api/concepts/{concept_id}")
def get_concept(concept_id: int):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM concepts WHERE id = ?", (concept_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Concept not found")
        return dict(row)
    finally:
        conn.close()


@app.put("/api/concepts/{concept_id}")
def update_concept(concept_id: int, data: ConceptUpdate):
    now = datetime.utcnow().isoformat()
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM concepts WHERE id = ?", (concept_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Concept not found")

        updates: dict = {}
        if data.title is not None:
            updates["title"] = data.title
        if data.content is not None:
            updates["content"] = data.content
        if data.tags is not None:
            updates["tags"] = json.dumps(data.tags)
        updates["updated_at"] = now

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [concept_id]
        conn.execute(f"UPDATE concepts SET {set_clause} WHERE id = ?", values)
        conn.commit()

        row = conn.execute(
            "SELECT * FROM concepts WHERE id = ?", (concept_id,)
        ).fetchone()
        return dict(row)
    finally:
        conn.close()


@app.delete("/api/concepts/{concept_id}")
def delete_concept(concept_id: int):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id FROM concepts WHERE id = ?", (concept_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Concept not found")
        conn.execute(
            "DELETE FROM links WHERE source_id = ? OR target_id = ?",
            (concept_id, concept_id),
        )
        conn.execute("DELETE FROM concepts WHERE id = ?", (concept_id,))
        conn.commit()
        return {"message": "Concept deleted"}
    finally:
        conn.close()


# ── Links ─────────────────────────────────────────────────────────────────────

@app.get("/api/links")
def list_links():
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM links").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/api/links/for/{concept_id}")
def links_for_concept(concept_id: int):
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT l.id, l.source_id, l.target_id, l.label,
                   c1.title AS source_title, c2.title AS target_title
            FROM links l
            JOIN concepts c1 ON l.source_id = c1.id
            JOIN concepts c2 ON l.target_id = c2.id
            WHERE l.source_id = ? OR l.target_id = ?
            """,
            (concept_id, concept_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/links", status_code=201)
def create_link(data: LinkCreate):
    now = datetime.utcnow().isoformat()
    conn = get_db()
    try:
        for cid in [data.source_id, data.target_id]:
            if not conn.execute(
                "SELECT id FROM concepts WHERE id = ?", (cid,)
            ).fetchone():
                raise HTTPException(
                    status_code=404, detail=f"Concept {cid} not found"
                )
        try:
            cursor = conn.execute(
                "INSERT INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)",
                (data.source_id, data.target_id, data.label, now),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM links WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
            return dict(row)
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Link already exists")
    finally:
        conn.close()


@app.delete("/api/links/{link_id}")
def delete_link(link_id: int):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id FROM links WHERE id = ?", (link_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Link not found")
        conn.execute("DELETE FROM links WHERE id = ?", (link_id,))
        conn.commit()
        return {"message": "Link deleted"}
    finally:
        conn.close()


# ── Graph ─────────────────────────────────────────────────────────────────────

@app.get("/api/graph")
def get_graph():
    conn = get_db()
    try:
        concepts = conn.execute(
            "SELECT id, title, tags FROM concepts"
        ).fetchall()
        links = conn.execute(
            "SELECT id, source_id, target_id, label FROM links"
        ).fetchall()
        return {
            "nodes": [dict(c) for c in concepts],
            "links": [dict(l) for l in links],
        }
    finally:
        conn.close()


# ── AI Chat ───────────────────────────────────────────────────────────────────

async def stream_chat(
    messages: List[dict], include_context: bool
) -> AsyncGenerator[str, None]:
    system_parts = [
        "You are a knowledgeable assistant helping the user manage their "
        "Zettelkasten knowledge base. You can analyze concepts, suggest "
        "connections between ideas, identify knowledge gaps, help organize "
        "information, and generate new insights from existing notes. "
        "When suggesting connections or new concepts, be specific and actionable."
    ]

    if include_context:
        conn = get_db()
        try:
            concepts = conn.execute(
                "SELECT id, title, content, tags FROM concepts"
            ).fetchall()
            links = conn.execute(
                """
                SELECT l.id, c1.title AS source, c2.title AS target, l.label
                FROM links l
                JOIN concepts c1 ON l.source_id = c1.id
                JOIN concepts c2 ON l.target_id = c2.id
                """
            ).fetchall()

            if concepts:
                system_parts.append("\n\n## Knowledge Base Concepts\n")
                for c in concepts:
                    tags = json.loads(c["tags"]) if c["tags"] else []
                    system_parts.append(f"\n### [{c['id']}] {c['title']}")
                    if tags:
                        system_parts.append(f"\nTags: {', '.join(tags)}")
                    if c["content"]:
                        preview = c["content"][:600]
                        if len(c["content"]) > 600:
                            preview += "…"
                        system_parts.append(f"\n{preview}")
            else:
                system_parts.append(
                    "\n\n(The knowledge base is currently empty. "
                    "Encourage the user to create their first concept.)"
                )

            if links:
                system_parts.append("\n\n## Concept Connections\n")
                for lnk in links:
                    label = f" ({lnk['label']})" if lnk["label"] else ""
                    system_parts.append(
                        f"\n- **{lnk['source']}** → **{lnk['target']}**{label}"
                    )
        finally:
            conn.close()

    system_prompt = "".join(system_parts)

    try:
        with client.messages.stream(
            model="claude-opus-4-6",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=system_prompt,
            messages=messages,
        ) as stream:
            thinking_started = False
            for event in stream:
                if not hasattr(event, "type"):
                    continue
                if event.type == "content_block_start":
                    if (
                        hasattr(event, "content_block")
                        and event.content_block.type == "thinking"
                    ):
                        thinking_started = True
                        yield f"data: {json.dumps({'type': 'thinking_start'})}\n\n"
                elif event.type == "content_block_stop":
                    if thinking_started:
                        thinking_started = False
                        yield f"data: {json.dumps({'type': 'thinking_end'})}\n\n"
                elif event.type == "content_block_delta":
                    if not hasattr(event, "delta"):
                        continue
                    if event.delta.type == "text_delta":
                        yield f"data: {json.dumps({'type': 'text', 'content': event.delta.text})}\n\n"
                elif event.type == "message_stop":
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
    except Exception as exc:
        yield f"data: {json.dumps({'type': 'error', 'content': str(exc)})}\n\n"


@app.post("/api/chat")
async def chat(request: ChatRequest):
    return StreamingResponse(
        stream_chat(request.messages, request.include_context),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Static files ──────────────────────────────────────────────────────────────

static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
