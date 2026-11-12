"""SQLite persistence for runs, mission events, screenshots and templates."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from . import config

_LOCK = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
	id TEXT PRIMARY KEY,
	task TEXT NOT NULL,
	status TEXT NOT NULL,
	created_at REAL NOT NULL,
	started_at REAL,
	finished_at REAL,
	provider TEXT NOT NULL,
	model TEXT NOT NULL,
	browser_mode TEXT NOT NULL,
	headless INTEGER NOT NULL DEFAULT 1,
	allowed_domains TEXT NOT NULL DEFAULT '[]',
	prohibited_domains TEXT NOT NULL DEFAULT '[]',
	max_steps INTEGER NOT NULL,
	timeout_s INTEGER NOT NULL,
	result_text TEXT,
	error TEXT,
	steps INTEGER,
	cost_usd REAL,
	usage TEXT NOT NULL DEFAULT '{}',
	success INTEGER,
	cancelled INTEGER NOT NULL DEFAULT 0,
	workspace TEXT,
	duration_s REAL,
	risk_flags TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id TEXT NOT NULL,
	ts REAL NOT NULL,
	kind TEXT NOT NULL,
	level TEXT NOT NULL DEFAULT 'info',
	message TEXT NOT NULL,
	data TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);

CREATE TABLE IF NOT EXISTS screenshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id TEXT NOT NULL,
	ts REAL NOT NULL,
	label TEXT NOT NULL,
	filename TEXT NOT NULL,
	UNIQUE(run_id, filename)
);

CREATE TABLE IF NOT EXISTS templates (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	prompt TEXT NOT NULL,
	category TEXT NOT NULL,
	built_in INTEGER NOT NULL DEFAULT 0,
	created_at REAL NOT NULL
);
"""

BUILTIN_TEMPLATES = [
	(
		'price-watch',
		'Competitor price check',
		'Visit https://news.ycombinator.com and report the titles and point counts of the top 5 stories. '
		'Return a compact markdown table with title and points.',
		'Research',
	),
	(
		'form-audit',
		'Landing page audit',
		'Open https://example.com and describe every visible navigation link, its label and destination URL. '
		'Do not click anything that submits a form or changes state.',
		'QA',
	),
	(
		'docs-extract',
		'Docs extraction',
		'Open https://docs.browser-use.com and extract the headings of the Python library quickstart. '
		'Summarise the required setup steps in five bullets.',
		'Research',
	),
	(
		'repo-scan',
		'Repository scan',
		'Open https://github.com/browser-use/browser-use and report the repository description, star count and '
		'the latest release version shown on the page.',
		'Research',
	),
	(
		'visual-check',
		'Visual snapshot',
		'Open https://example.com and take a screenshot, then describe the page layout and any visible buttons.',
		'QA',
	),
]


def _connect() -> sqlite3.Connection:
	config.DATA_DIR.mkdir(parents=True, exist_ok=True)
	conn = sqlite3.connect(config.DB_PATH, timeout=15)
	conn.row_factory = sqlite3.Row
	conn.execute('PRAGMA journal_mode=WAL')
	conn.execute('PRAGMA foreign_keys=ON')
	return conn


def init() -> None:
	with _LOCK, _connect() as conn:
		conn.executescript(SCHEMA)
		count = conn.execute('SELECT COUNT(*) FROM templates WHERE built_in = 1').fetchone()[0]
		if not count:
			now = time.time()
			conn.executemany(
				'INSERT INTO templates (id, title, prompt, category, built_in, created_at) VALUES (?, ?, ?, ?, 1, ?)',
				[(i, t, p, c, now) for i, t, p, c in BUILTIN_TEMPLATES],
			)


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
	if row is None:
		return None
	data = dict(row)
	for key in ('allowed_domains', 'prohibited_domains', 'usage', 'risk_flags'):
		if key in data and isinstance(data[key], str):
			try:
				data[key] = json.loads(data[key])
			except ValueError:
				data[key] = []
	if 'success' in data and data['success'] is not None:
		data['success'] = bool(data['success'])
	if 'headless' in data:
		data['headless'] = bool(data['headless'])
	if 'cancelled' in data:
		data['cancelled'] = bool(data['cancelled'])
	return data


def create_run(payload: dict[str, Any]) -> dict[str, Any]:
	run_id = payload.get('id') or uuid.uuid4().hex
	with _LOCK, _connect() as conn:
		conn.execute(
			"""
			INSERT INTO runs (id, task, status, created_at, provider, model, browser_mode, headless,
				allowed_domains, prohibited_domains, max_steps, timeout_s, workspace, risk_flags)
			VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			(
				run_id,
				payload['task'],
				time.time(),
				payload['provider'],
				payload['model'],
				payload['browser_mode'],
				1 if payload.get('headless', True) else 0,
				json.dumps(payload.get('allowed_domains', [])),
				json.dumps(payload.get('prohibited_domains', [])),
				payload['max_steps'],
				payload['timeout_s'],
				payload.get('workspace'),
				json.dumps(payload.get('risk_flags', [])),
			),
		)
		row = conn.execute('SELECT * FROM runs WHERE id = ?', (run_id,)).fetchone()
	return _row(row)  # type: ignore[return-value]


def get_run(run_id: str) -> dict[str, Any] | None:
	with _connect() as conn:
		return _row(conn.execute('SELECT * FROM runs WHERE id = ?', (run_id,)).fetchone())


def list_runs(status: str | None = None, query: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
	sql = 'SELECT * FROM runs'
	where, args = [], []
	if status and status != 'all':
		where.append('status = ?')
		args.append(status)
	if query:
		where.append('task LIKE ?')
		args.append(f'%{query}%')
	if where:
		sql += ' WHERE ' + ' AND '.join(where)
	sql += ' ORDER BY created_at DESC LIMIT ?'
	args.append(limit)
	with _connect() as conn:
		return [_row(r) for r in conn.execute(sql, args)]  # type: ignore[misc]


def run_stats() -> dict[str, Any]:
	with _connect() as conn:
		rows = conn.execute('SELECT status, COUNT(*) c, SUM(cost_usd) cost FROM runs GROUP BY status').fetchall()
		total = conn.execute('SELECT COUNT(*) FROM runs').fetchone()[0]
		active = conn.execute("SELECT COUNT(*) FROM runs WHERE status IN ('queued','running')").fetchone()[0]
		today = conn.execute('SELECT COUNT(*) FROM runs WHERE created_at >= ?', (time.time() - 86400,)).fetchone()[0]
		cost = conn.execute('SELECT SUM(cost_usd) FROM runs').fetchone()[0] or 0
	return {
		'total': total,
		'active': active,
		'last_24h': today,
		'total_cost_usd': round(cost, 6),
		'by_status': {r['status']: r['c'] for r in rows},
	}


def update_run(run_id: str, **fields: Any) -> None:
	if not fields:
		return
	allowed = {
		'status',
		'started_at',
		'finished_at',
		'result_text',
		'error',
		'steps',
		'cost_usd',
		'usage',
		'success',
		'cancelled',
		'duration_s',
	}
	parts, args = [], []
	for key, value in fields.items():
		if key not in allowed:
			continue
		parts.append(f'{key} = ?')
		args.append(json.dumps(value) if key == 'usage' else value)
	args.append(run_id)
	with _LOCK, _connect() as conn:
		conn.execute(f'UPDATE runs SET {", ".join(parts)} WHERE id = ?', args)


def add_event(
	run_id: str,
	kind: str,
	message: str,
	*,
	level: str = 'info',
	data: dict[str, Any] | None = None,
	ts: float | None = None,
) -> int:
	with _LOCK, _connect() as conn:
		cur = conn.execute(
			'INSERT INTO events (run_id, ts, kind, level, message, data) VALUES (?, ?, ?, ?, ?, ?)',
			(run_id, ts or time.time(), kind, level, message, json.dumps(data or {})),
		)
		return int(cur.lastrowid)


def list_events(run_id: str, after: int = 0, limit: int = 500) -> list[dict[str, Any]]:
	with _connect() as conn:
		rows = conn.execute(
			'SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?',
			(run_id, after, limit),
		).fetchall()
		out = []
		for row in rows:
			item = dict(row)
			try:
				item['data'] = json.loads(item['data'])
			except ValueError:
				item['data'] = {}
			out.append(item)
		return out


def add_screenshot(run_id: str, filename: str, label: str, ts: float) -> None:
	with _LOCK, _connect() as conn:
		conn.execute(
			'INSERT OR IGNORE INTO screenshots (run_id, ts, label, filename) VALUES (?, ?, ?, ?)',
			(run_id, ts, label, filename),
		)


def list_screenshots(run_id: str) -> list[dict[str, Any]]:
	with _connect() as conn:
		return [dict(r) for r in conn.execute('SELECT * FROM screenshots WHERE run_id = ? ORDER BY id ASC', (run_id,))]


def list_templates() -> list[dict[str, Any]]:
	with _connect() as conn:
		return [dict(r) for r in conn.execute('SELECT * FROM templates ORDER BY built_in DESC, created_at ASC')]


def add_template(title: str, prompt: str, category: str) -> dict[str, Any]:
	template_id = uuid.uuid4().hex[:12]
	with _LOCK, _connect() as conn:
		conn.execute(
			'INSERT INTO templates (id, title, prompt, category, built_in, created_at) VALUES (?, ?, ?, ?, 0, ?)',
			(template_id, title, prompt, category, time.time()),
		)
	return {'id': template_id, 'title': title, 'prompt': prompt, 'category': category, 'built_in': 0}


def delete_template(template_id: str) -> bool:
	with _LOCK, _connect() as conn:
		cur = conn.execute('DELETE FROM templates WHERE id = ? AND built_in = 0', (template_id,))
		return cur.rowcount > 0


def mark_interrupted_runs() -> None:
	"""A run whose server process died must not stay 'running' forever."""
	with _LOCK, _connect() as conn:
		conn.execute(
			"""UPDATE runs SET status = 'failed', error = 'Server stopped while this run was active.',
			   finished_at = ? WHERE status IN ('queued', 'running')""",
			(time.time(),),
		)


def screenshot_dir(run_id: str) -> Path:
	path = config.SCREENSHOTS_DIR / run_id
	path.mkdir(parents=True, exist_ok=True)
	return path
