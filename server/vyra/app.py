"""FastAPI application: the VYRA control surface around the browser-use engine."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, db
from .runner import manager

logger = logging.getLogger('vyra')

ROOT = config.ROOT
WEB_DIST = ROOT / 'web' / 'dist'
DOMAIN_RE = re.compile(r'^[a-z0-9*][a-z0-9.*:_-]{0,252}$')


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
	db.init()
	db.mark_interrupted_runs()
	config.WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)
	config.SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
	yield


app = FastAPI(title='VYRA API', version='1.0.0', lifespan=lifespan)
DEFAULT_CORS_ORIGINS = [
	'http://localhost:5173',
	'http://127.0.0.1:5173',
	'http://localhost:4173',
	'http://127.0.0.1:4173',
]


def _cors_origins() -> list[str]:
	extra = os.environ.get('VYRA_CORS_ORIGINS', '')
	origins = DEFAULT_CORS_ORIGINS + [item.strip().rstrip('/') for item in extra.split(',') if item.strip()]
	return list(dict.fromkeys(origins))


app.add_middleware(
	CORSMiddleware,
	allow_origins=_cors_origins(),
	# Optional regex for provider previews, e.g. https://vyra-.*\.vercel\.app
	allow_origin_regex=os.environ.get('VYRA_CORS_ORIGIN_REGEX') or None,
	allow_credentials=False,
	allow_methods=['*'],
	allow_headers=['*'],
)


class RunCreate(BaseModel):
	task: str = Field(min_length=3, max_length=8000)
	provider: str = Field(default='openai', max_length=40)
	model: str = Field(default='', max_length=120)
	browser_mode: str = Field(default='local', max_length=20)
	headless: bool = True
	allowed_domains: list[str] = Field(default_factory=list, max_length=20)
	prohibited_domains: list[str] = Field(default_factory=list, max_length=20)
	max_steps: int = Field(default=config.DEFAULT_MAX_STEPS, ge=1, le=200)
	timeout_s: int = Field(default=config.DEFAULT_TIMEOUT_S, ge=30, le=1700)
	acknowledge_risk: bool = False


class TemplateCreate(BaseModel):
	title: str = Field(min_length=2, max_length=80)
	prompt: str = Field(min_length=5, max_length=8000)
	category: str = Field(default='Custom', max_length=30)


def _engine_tools() -> list[dict[str, Any]]:
	"""Capabilities the checked-out engine actually exposes (from its own source)."""
	return [
		{
			'id': 'python-repl',
			'name': 'Persistent Python REPL',
			'detail': 'The model writes Python cells that run in one persistent REPL against the browser session.',
			'source': 'browser_use/repl',
		},
		{
			'id': 'cdp',
			'name': 'Raw Chrome DevTools Protocol',
			'detail': 'Cells call cdp(method, ...) directly for navigation, input, emulation, network and page capture.',
			'source': 'browser_use/repl/worker.py',
		},
		{
			'id': 'helpers',
			'name': 'browser-harness helpers',
			'detail': 'new_tab, click, type, keys, scroll, js, page_info, screenshot, upload_file and the other pinned helpers.',
			'source': 'browser-harness 0.1.13',
		},
		{
			'id': 'local-browser',
			'name': 'Local Chromium / attached Chrome',
			'detail': "Browser('chromium') launches a disposable profile; Browser('chrome') attaches to your open Chrome.",
			'source': 'browser_use/browser',
		},
		{
			'id': 'cloud-browser',
			'name': 'Browser Use Cloud browser',
			'detail': 'Optional hosted browser with stealth and CAPTCHA solving. Requires a Browser Use key and is billed.',
			'source': 'browser_use/browser/browser.py',
		},
		{
			'id': 'domain-rules',
			'name': 'Domain allow / block rules',
			'detail': 'Enforced by the browser helpers and main-frame navigation. A guard, not a sandbox.',
			'source': 'browser_use/domains.py',
		},
		{
			'id': 'mcp',
			'name': 'MCP server mode',
			'detail': 'The upstream package ships an MCP server entrypoint (browser-use --cli-mcp) outside this UI.',
			'source': 'browser_use/mcp',
		},
		{
			'id': 'custom-tools',
			'name': 'Custom @tools.action functions',
			'detail': 'Python functions registered as engine tools for programmatic embedding; the UI does not expose arbitrary code.',
			'source': 'browser_use/tools.py',
		},
	]


@app.get('/api/health')
def health() -> dict[str, Any]:
	return {
		'ok': True,
		'engine_installed': config.setup_snapshot()['engine']['installed'],
		'active_runs': manager.active_count,
	}


@app.get('/api/setup')
def setup() -> dict[str, Any]:
	return config.setup_snapshot()


@app.get('/api/settings')
def settings() -> dict[str, Any]:
	return {
		'setup': config.setup_snapshot(),
		'safety': {
			'execution_model': 'The engine writes and runs Python in a REPL as your OS user. Treat tasks as code execution.',
			'domain_rules': 'Allowed/prohibited domains guard the browser, not the model\u2019s Python or subresources.',
			'confirmation': 'High-impact verbs require an explicit acknowledgement before the task can be submitted.',
			'secrets': 'Provider keys are read from server/.env only and never sent to the browser.',
		},
	}


@app.get('/api/templates')
def templates() -> list[dict[str, Any]]:
	return db.list_templates()


@app.post('/api/templates', status_code=201)
def create_template(body: TemplateCreate) -> dict[str, Any]:
	return db.add_template(body.title.strip(), body.prompt.strip(), body.category.strip() or 'Custom')


@app.delete('/api/templates/{template_id}')
def remove_template(template_id: str) -> dict[str, bool]:
	if not db.delete_template(template_id):
		raise HTTPException(status_code=404, detail='Template not found or is built in.')
	return {'deleted': True}


@app.get('/api/profiles')
def profiles() -> dict[str, Any]:
	snapshot = config.setup_snapshot()
	return {
		'engines': snapshot['browsers'],
		'modes': config.BROWSER_MODES,
		'note': (
			'Local runs use a fresh browser profile inside the run workspace and delete it when the browser closes. '
			'Attached Chrome uses the session already open on this machine. VYRA never reads or returns cookies, '
			'passwords or raw profile directories.'
		),
	}


@app.get('/api/integrations')
def integrations() -> dict[str, Any]:
	snapshot = config.setup_snapshot()
	return {
		'providers': snapshot['providers'],
		'browsers': snapshot['browsers'],
		'cloud': snapshot['cloud_browser'],
		'tools': _engine_tools(),
		'engine': snapshot['engine'],
		'cost_note': (
			'The browser-use library is MIT licensed and free. Model inference, and any Browser Use Cloud browser, '
			'are billed separately by those providers.'
		),
	}


@app.get('/api/runs')
def runs(status: str | None = None, q: str | None = None, limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
	items = db.list_runs(status=status, query=q, limit=limit)
	return {'runs': items, 'stats': db.run_stats()}


@app.get('/api/runs/stats')
def run_stats() -> dict[str, Any]:
	return db.run_stats()


@app.post('/api/runs', status_code=201)
def create_run(body: RunCreate) -> dict[str, Any]:
	task = body.task.strip()
	if len(task) < 3:
		raise HTTPException(status_code=422, detail='Task is too short.')

	try:
		provider = config.resolve_provider(body.provider)
	except ValueError as exc:
		raise HTTPException(status_code=422, detail=str(exc)) from exc
	status = config.provider_status(provider)
	if not status['configured']:
		raise HTTPException(
			status_code=422,
			detail={
				'code': 'provider_not_configured',
				'message': f'{provider["label"]} has no credentials on the server.',
				'missing_env': status['missing_env'],
			},
		)

	if body.browser_mode not in {m['id'] for m in config.BROWSER_MODES}:
		raise HTTPException(status_code=422, detail='Unsupported browser mode.')
	if body.browser_mode == 'cloud' and not config.setup_snapshot()['cloud_browser']['available']:
		raise HTTPException(
			status_code=422,
			detail={
				'code': 'browser_not_configured',
				'message': 'Cloud browser requires BROWSER_USE_API_KEY on the server.',
				'missing_env': ['BROWSER_USE_API_KEY'],
			},
		)
	if body.browser_mode == 'local' and not config.setup_snapshot()['browsers']:
		raise HTTPException(
			status_code=422,
			detail={'code': 'browser_not_configured', 'message': 'No Chrome, Chromium or Edge installation was detected.'},
		)

	def clean_domains(values: list[str], label: str) -> list[str]:
		out: list[str] = []
		for raw in values:
			value = raw.strip().lower()
			if not value:
				continue
			if not DOMAIN_RE.match(value):
				raise HTTPException(status_code=422, detail=f'{label}: invalid domain pattern "{raw}".')
			if value not in out:
				out.append(value)
		return out

	allowed = clean_domains(body.allowed_domains, 'Allowed domains')
	prohibited = clean_domains(body.prohibited_domains, 'Prohibited domains')
	if set(allowed) & set(prohibited):
		raise HTTPException(status_code=422, detail='A domain cannot be both allowed and prohibited.')
	if body.browser_mode == 'cloud' and allowed and config.setup_snapshot()['providers'][0]['configured']:
		# Allowed domains still work with cloud browsers; the note is guidance, not a block.
		pass

	model = body.model.strip() or provider['default_model']
	if not re.match(r'^[A-Za-z0-9._:/@-]{1,120}$', model):
		raise HTTPException(status_code=422, detail='Model id contains unsupported characters.')

	flags = config.risk_flags(task)
	if flags and not body.acknowledge_risk:
		raise HTTPException(
			status_code=422,
			detail={
				'code': 'confirmation_required',
				'message': 'This task can make a high-impact change. Confirm that you want the agent to proceed.',
				'flags': flags,
			},
		)

	if manager.active_count >= config.MAX_ACTIVE_RUNS:
		raise HTTPException(
			status_code=429,
			detail=f'Concurrency limit reached ({config.MAX_ACTIVE_RUNS} active runs). Wait for a run to finish or cancel one.',
		)

	created = db.create_run(
		{
			'task': task,
			'provider': provider['id'],
			'model': model,
			'browser_mode': body.browser_mode,
			'headless': body.headless if body.browser_mode == 'local' else False,
			'allowed_domains': allowed,
			'prohibited_domains': prohibited,
			'max_steps': body.max_steps,
			'timeout_s': body.timeout_s,
			'risk_flags': flags,
		}
	)
	db.add_event(created['id'], 'lifecycle', 'Run queued.')
	manager.start(created['id'])
	return db.get_run(created['id']) or created


@app.get('/api/runs/{run_id}')
def get_run(run_id: str) -> dict[str, Any]:
	run = db.get_run(run_id)
	if not run:
		raise HTTPException(status_code=404, detail='Run not found.')
	run['events'] = db.list_events(run_id)
	run['screenshots'] = db.list_screenshots(run_id)
	return run


@app.get('/api/runs/{run_id}/events')
def get_events(run_id: str, after: int = 0) -> dict[str, Any]:
	if not db.get_run(run_id):
		raise HTTPException(status_code=404, detail='Run not found.')
	return {'events': db.list_events(run_id, after=after)}


def _sse(event: dict[str, Any]) -> str:
	return f"id: {event['id']}\ndata: {json.dumps(event, default=str)}\n\n"


@app.get('/api/runs/{run_id}/events/stream')
async def stream_events(run_id: str, request: Request, after: int = 0) -> StreamingResponse:
	run = db.get_run(run_id)
	if not run:
		raise HTTPException(status_code=404, detail='Run not found.')

	async def generator() -> AsyncIterator[str]:
		cursor = after
		last_beat = time.time()
		terminal_checks = 0
		while True:
			if await request.is_disconnected():
				break
			events = db.list_events(run_id, after=cursor)
			for event in events:
				cursor = event['id']
				yield _sse(event)
			current = db.get_run(run_id)
			if current and current['status'] in ('completed', 'failed', 'cancelled', 'timeout', 'max_steps'):
				terminal_checks += 1
				if not events and terminal_checks >= 2:
					yield f'event: done\ndata: {json.dumps({"status": current["status"]})}\n\n'
					break
			else:
				terminal_checks = 0
			if time.time() - last_beat > 15:
				last_beat = time.time()
				yield ': keep-alive\n\n'
			import asyncio

			await asyncio.sleep(0.6)

	return StreamingResponse(
		generator(),
		media_type='text/event-stream',
		headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive'},
	)


@app.post('/api/runs/{run_id}/cancel')
def cancel_run(run_id: str) -> dict[str, Any]:
	if not db.get_run(run_id):
		raise HTTPException(status_code=404, detail='Run not found.')
	if not manager.cancel(run_id):
		raise HTTPException(status_code=409, detail='Only a queued or running run can be cancelled.')
	return db.get_run(run_id) or {}


@app.post('/api/runs/{run_id}/retry', status_code=201)
def retry_run(run_id: str) -> dict[str, Any]:
	run = db.get_run(run_id)
	if not run:
		raise HTTPException(status_code=404, detail='Run not found.')
	if manager.active_count >= config.MAX_ACTIVE_RUNS:
		raise HTTPException(status_code=429, detail='Concurrency limit reached. Wait for an active run to finish.')
	created = db.create_run(
		{
			'task': run['task'],
			'provider': run['provider'],
			'model': run['model'],
			'browser_mode': run['browser_mode'],
			'headless': run['headless'],
			'allowed_domains': run['allowed_domains'],
			'prohibited_domains': run['prohibited_domains'],
			'max_steps': run['max_steps'],
			'timeout_s': run['timeout_s'],
			'risk_flags': run['risk_flags'],
		}
	)
	db.add_event(created['id'], 'lifecycle', f'Re-run of {run_id[:8]}.')
	manager.start(created['id'])
	return db.get_run(created['id']) or created


@app.get('/api/runs/{run_id}/screenshots/{filename}')
def get_screenshot(run_id: str, filename: str) -> FileResponse:
	name = Path(filename).name
	if name != filename:
		raise HTTPException(status_code=400, detail='Invalid filename.')
	path = config.SCREENSHOTS_DIR / run_id / name
	if not path.is_file():
		raise HTTPException(status_code=404, detail='Screenshot not found.')
	return FileResponse(path, headers={'Cache-Control': 'private, max-age=3600'})


if WEB_DIST.is_dir():
	app.mount('/assets', StaticFiles(directory=WEB_DIST / 'assets'), name='assets')
	app.mount('/fonts', StaticFiles(directory=WEB_DIST), name='dist-root')


@app.get('/{full_path:path}')
def spa(full_path: str) -> Any:
	if full_path.startswith('api/'):
		raise HTTPException(status_code=404, detail='Not found.')
	index = WEB_DIST / 'index.html'
	if index.is_file():
		if full_path:
			candidate = (WEB_DIST / full_path).resolve()
			if candidate.is_file() and str(candidate).startswith(str(WEB_DIST.resolve())):
				return FileResponse(candidate)
		return FileResponse(index)
	return JSONResponse(
		status_code=503,
		content={'detail': 'Frontend not built. Run "npm run build" in web/ or use the Vite dev server on :5173.'},
	)
