import json
import sqlite3
from flask import Flask, g, jsonify, render_template, request

app = Flask(__name__)
DATABASE = "zettelkasten.db"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE, detect_types=sqlite3.PARSE_DECLTYPES)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS notes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT NOT NULL,
            content    TEXT NOT NULL DEFAULT '',
            tags       TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS links (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            target_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            UNIQUE(source_id, target_id)
        );
        """
    )
    db.commit()
    db.close()


def row_to_dict(row):
    d = dict(row)
    if "tags" in d:
        try:
            d["tags"] = json.loads(d["tags"] or "[]")
        except Exception:
            d["tags"] = []
    return d


# ---------------------------------------------------------------------------
# Routes – UI
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Routes – Notes
# ---------------------------------------------------------------------------

@app.route("/api/notes", methods=["GET"])
def list_notes():
    db = get_db()
    rows = db.execute("SELECT * FROM notes ORDER BY updated_at DESC").fetchall()
    result = []
    for row in rows:
        d = row_to_dict(row)
        d["link_count"] = db.execute(
            "SELECT COUNT(*) FROM links WHERE source_id=? OR target_id=?",
            (d["id"], d["id"]),
        ).fetchone()[0]
        result.append(d)
    return jsonify(result)


@app.route("/api/notes", methods=["POST"])
def create_note():
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Title is required"}), 400
    tags = json.dumps([t.strip() for t in data.get("tags", []) if str(t).strip()])
    db = get_db()
    cur = db.execute(
        "INSERT INTO notes (title, content, tags) VALUES (?, ?, ?)",
        (title, data.get("content", ""), tags),
    )
    db.commit()
    d = row_to_dict(
        db.execute("SELECT * FROM notes WHERE id=?", (cur.lastrowid,)).fetchone()
    )
    d["link_count"] = 0
    return jsonify(d), 201


@app.route("/api/notes/<int:nid>", methods=["GET"])
def get_note(nid):
    db = get_db()
    row = db.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    d = row_to_dict(row)
    linked = db.execute(
        """
        SELECT n.id, n.title, n.tags FROM notes n
        JOIN links l ON (l.source_id=n.id AND l.target_id=?)
                     OR (l.target_id=n.id AND l.source_id=?)
        ORDER BY n.title
        """,
        (nid, nid),
    ).fetchall()
    d["linked_notes"] = [row_to_dict(r) for r in linked]
    d["link_count"] = len(d["linked_notes"])
    return jsonify(d)


@app.route("/api/notes/<int:nid>", methods=["PUT"])
def update_note(nid):
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Title is required"}), 400
    tags = json.dumps([t.strip() for t in data.get("tags", []) if str(t).strip()])
    db = get_db()
    db.execute(
        "UPDATE notes SET title=?, content=?, tags=?, updated_at=datetime('now') WHERE id=?",
        (title, data.get("content", ""), tags, nid),
    )
    db.commit()
    d = row_to_dict(db.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone())
    linked = db.execute(
        """
        SELECT n.id, n.title, n.tags FROM notes n
        JOIN links l ON (l.source_id=n.id AND l.target_id=?)
                     OR (l.target_id=n.id AND l.source_id=?)
        ORDER BY n.title
        """,
        (nid, nid),
    ).fetchall()
    d["linked_notes"] = [row_to_dict(r) for r in linked]
    d["link_count"] = len(d["linked_notes"])
    return jsonify(d)


@app.route("/api/notes/<int:nid>", methods=["DELETE"])
def delete_note(nid):
    db = get_db()
    db.execute("DELETE FROM notes WHERE id=?", (nid,))
    db.commit()
    return "", 204


# ---------------------------------------------------------------------------
# Routes – Links
# ---------------------------------------------------------------------------

@app.route("/api/links", methods=["POST"])
def create_link():
    data = request.get_json(force=True)
    src = data.get("source_id")
    tgt = data.get("target_id")
    if not src or not tgt or src == tgt:
        return jsonify({"error": "Invalid source or target"}), 400
    db = get_db()
    existing = db.execute(
        "SELECT * FROM links WHERE (source_id=? AND target_id=?) OR (source_id=? AND target_id=?)",
        (src, tgt, tgt, src),
    ).fetchone()
    if existing:
        return jsonify(dict(existing)), 200
    try:
        cur = db.execute(
            "INSERT INTO links (source_id, target_id) VALUES (?, ?)", (src, tgt)
        )
        db.commit()
        return jsonify({"id": cur.lastrowid, "source_id": src, "target_id": tgt}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/links/between/<int:a>/<int:b>", methods=["DELETE"])
def delete_link_between(a, b):
    db = get_db()
    db.execute(
        "DELETE FROM links WHERE (source_id=? AND target_id=?) OR (source_id=? AND target_id=?)",
        (a, b, b, a),
    )
    db.commit()
    return "", 204


# ---------------------------------------------------------------------------
# Routes – Graph
# ---------------------------------------------------------------------------

@app.route("/api/graph")
def get_graph():
    db = get_db()
    notes = db.execute("SELECT id, title, tags FROM notes").fetchall()
    links = db.execute("SELECT id, source_id, target_id FROM links").fetchall()
    degree = {}
    for lnk in links:
        degree[lnk["source_id"]] = degree.get(lnk["source_id"], 0) + 1
        degree[lnk["target_id"]] = degree.get(lnk["target_id"], 0) + 1
    nodes = [
        {
            "id": n["id"],
            "title": n["title"],
            "tags": json.loads(n["tags"] or "[]"),
            "degree": degree.get(n["id"], 0),
        }
        for n in notes
    ]
    edges = [
        {"id": l["id"], "source": l["source_id"], "target": l["target_id"]}
        for l in links
    ]
    return jsonify({"nodes": nodes, "edges": edges})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
