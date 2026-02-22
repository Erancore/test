import json
import sqlite3
from flask import Flask, g, jsonify, render_template, request

app = Flask(__name__)
DATABASE = "tasks.db"


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
        CREATE TABLE IF NOT EXISTS projects (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title       TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            priority    TEXT NOT NULL DEFAULT 'medium'
                        CHECK(priority IN ('low', 'medium', 'high')),
            status      TEXT NOT NULL DEFAULT 'todo'
                        CHECK(status IN ('todo', 'in_progress', 'done')),
            due_date    TEXT,
            tags        TEXT NOT NULL DEFAULT '[]',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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
# Routes – Projects
# ---------------------------------------------------------------------------

@app.route("/api/projects", methods=["GET"])
def list_projects():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM projects ORDER BY created_at DESC"
    ).fetchall()
    result = []
    for row in rows:
        d = row_to_dict(row)
        d["task_count"] = db.execute(
            "SELECT COUNT(*) FROM tasks WHERE project_id = ?", (d["id"],)
        ).fetchone()[0]
        d["done_count"] = db.execute(
            "SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'done'",
            (d["id"],),
        ).fetchone()[0]
        result.append(d)
    return jsonify(result)


@app.route("/api/projects", methods=["POST"])
def create_project():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    db = get_db()
    cur = db.execute(
        "INSERT INTO projects (name, description) VALUES (?, ?)",
        (name, data.get("description", "")),
    )
    db.commit()
    d = row_to_dict(
        db.execute("SELECT * FROM projects WHERE id = ?", (cur.lastrowid,)).fetchone()
    )
    d["task_count"] = 0
    d["done_count"] = 0
    return jsonify(d), 201


@app.route("/api/projects/<int:pid>", methods=["PUT"])
def update_project(pid):
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    db = get_db()
    db.execute(
        "UPDATE projects SET name = ?, description = ? WHERE id = ?",
        (name, data.get("description", ""), pid),
    )
    db.commit()
    return jsonify(
        row_to_dict(
            db.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
        )
    )


@app.route("/api/projects/<int:pid>", methods=["DELETE"])
def delete_project(pid):
    db = get_db()
    db.execute("DELETE FROM projects WHERE id = ?", (pid,))
    db.commit()
    return "", 204


# ---------------------------------------------------------------------------
# Routes – Tasks
# ---------------------------------------------------------------------------

@app.route("/api/tasks", methods=["GET"])
def list_all_tasks():
    db = get_db()
    rows = db.execute(
        """
        SELECT t.*, p.name AS project_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        ORDER BY t.created_at DESC
        """
    ).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/projects/<int:pid>/tasks", methods=["GET"])
def list_tasks(pid):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC", (pid,)
    ).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/projects/<int:pid>/tasks", methods=["POST"])
def create_task(pid):
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Title is required"}), 400
    tags = json.dumps(
        [t.strip() for t in data.get("tags", []) if str(t).strip()]
    )
    db = get_db()
    cur = db.execute(
        """INSERT INTO tasks
           (project_id, title, description, priority, due_date, tags)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            pid,
            title,
            data.get("description", ""),
            data.get("priority", "medium"),
            data.get("due_date") or None,
            tags,
        ),
    )
    db.commit()
    return jsonify(
        row_to_dict(
            db.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
        )
    ), 201


@app.route("/api/tasks/<int:tid>", methods=["PUT"])
def update_task(tid):
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Title is required"}), 400
    tags = json.dumps(
        [t.strip() for t in data.get("tags", []) if str(t).strip()]
    )
    db = get_db()
    db.execute(
        """UPDATE tasks
           SET title = ?, description = ?, priority = ?, status = ?,
               due_date = ?, tags = ?
           WHERE id = ?""",
        (
            title,
            data.get("description", ""),
            data.get("priority", "medium"),
            data.get("status", "todo"),
            data.get("due_date") or None,
            tags,
            tid,
        ),
    )
    db.commit()
    return jsonify(
        row_to_dict(
            db.execute("SELECT * FROM tasks WHERE id = ?", (tid,)).fetchone()
        )
    )


@app.route("/api/tasks/<int:tid>", methods=["DELETE"])
def delete_task(tid):
    db = get_db()
    db.execute("DELETE FROM tasks WHERE id = ?", (tid,))
    db.commit()
    return "", 204


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
