"""Run lifecycle around the real browser-use agent.

Each run executes in its own thread with its own asyncio event loop. One Agent
and one Browser per run, exactly as the engine expects. Live events come from
the engine's own logger (``browser_use``); screenshots come from the engine's
REPL workspace, which is where the agent's real ``screenshot()`` writes. Nothing
here fabricates a run, a page state, or a screenshot.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from . import config, db


class _DBLogHandler(logging.Handler):
	"""Persist the engine's log lines for one run, from that run's thread only."""

	def __init__(self, run_id: str, thread_id: int) -> None:
		super().__init__(level=logging.INFO)
		self.run_id = run_id
		self.thread_id = thread_id

	def emit(self, record: logging.LogRecord) -> None:
		if record.thread != self.thread_id:
			return
		try:
			message = config.redact(record.getMessage())
			message = message.strip()
			if not message:
				return
			if len(message) > 4000:
				message = message[:4000] + '…'
			kind = 'step' if message.startswith('step ') else 'log'
			if record.levelno >= logging.ERROR:
				level = 'error'
			elif record.levelno >= logging.WARNING:
				level = 'warning'
			else:
				level = 'info'
			db.add_event(self.run_id, kind, message, level=level)
		except Exception:
			# Logging must never break a run.
			pass


class RunManager:
	def __init__(self) -> None:
		self._lock = threading.Lock()
		self._active: dict[str, dict[str, Any]] = {}

	@property
	def active_count(self) -> int:
		with self._lock:
			return len(self._active)

	def start(self, run_id: str) -> None:
		with self._lock:
			if run_id in self._active:
				return
			entry: dict[str, Any] = {'cancel': False, 'loop': None, 'task': None, 'thread': None}
			self._active[run_id] = entry
		thread = threading.Thread(target=self._execute, args=(run_id, entry), name=f'vyra-run-{run_id[:8]}', daemon=True)
		entry['thread'] = thread
		thread.start()

	def cancel(self, run_id: str) -> bool:
		run = db.get_run(run_id)
		if not run or run['status'] not in ('queued', 'running'):
			return False
		with self._lock:
			entry = self._active.get(run_id)
		if entry is None:
			db.update_run(run_id, status='cancelled', cancelled=1, finished_at=time.time())
			db.add_event(run_id, 'lifecycle', 'Run cancelled before it started.', level='warning')
			return True
		entry['cancel'] = True
		loop = entry.get('loop')
		task = entry.get('task')
		if loop is not None and task is not None:
			loop.call_soon_threadsafe(task.cancel)
		return True

	# -- execution -------------------------------------------------------------
	def _execute(self, run_id: str, entry: dict[str, Any]) -> None:
		run = db.get_run(run_id)
		if not run:
			self._forget(run_id)
			return
		workspace = config.WORKSPACES_DIR / run_id
		workspace.mkdir(parents=True, exist_ok=True)
		stop_watch = threading.Event()
		watcher = threading.Thread(
			target=self._watch_screenshots, args=(run_id, workspace, stop_watch), daemon=True
		)
		watcher.start()

		handler = _DBLogHandler(run_id, threading.get_ident())
		engine_logger = logging.getLogger('browser_use')
		engine_logger.addHandler(handler)
		if engine_logger.level == logging.NOTSET:
			engine_logger.setLevel(logging.INFO)

		db.update_run(run_id, status='running', started_at=time.time(), workspace=str(workspace))
		db.add_event(
			run_id,
			'lifecycle',
			f"Run started — {run['provider']} / {run['model']} · browser: {run['browser_mode']}",
		)
		if run['allowed_domains']:
			db.add_event(run_id, 'guard', f"Allowed domains: {', '.join(run['allowed_domains'])}")
		if run['prohibited_domains']:
			db.add_event(run_id, 'guard', f"Prohibited domains: {', '.join(run['prohibited_domains'])}")

		result = None
		error: str | None = None
		cancelled = False
		started = time.monotonic()

		async def main() -> Any:
			loop = asyncio.get_running_loop()
			entry['loop'] = loop
			entry['task'] = asyncio.current_task()
			if entry.get('cancel'):
				raise asyncio.CancelledError
			from browser_use import Agent

			agent = Agent(
				run['task'],
				llm=config.build_llm(run['provider'], run['model']),
				browser=config.build_browser(
					run['browser_mode'],
					headless=run['headless'],
					allowed=run['allowed_domains'],
					prohibited=run['prohibited_domains'],
				),
				workspace=str(workspace),
			)
			db.add_event(
				run_id,
				'lifecycle',
				'Agent ready — starting the browser and the Python REPL.',
			)
			return await agent.run(max_steps=run['max_steps'], timeout=run['timeout_s'])

		try:
			result = asyncio.run(main())
		except asyncio.CancelledError:
			cancelled = True
		except Exception as exc:  # setup errors: missing key, no browser, provider failure
			error = config.redact(f'{type(exc).__name__}: {exc}')
		finally:
			stop_watch.set()
			engine_logger.removeHandler(handler)
			with contextlib.suppress(Exception):
				watcher.join(timeout=2)
			self._forget(run_id)

		finished = time.time()
		duration = round(time.monotonic() - started, 2)

		if cancelled or entry.get('cancel'):
			db.update_run(
				run_id,
				status='cancelled',
				cancelled=1,
				finished_at=finished,
				error='Cancelled by the user.',
				duration_s=duration,
			)
			db.add_event(run_id, 'lifecycle', 'Run cancelled. The browser session was stopped.', level='warning')
			return

		if error is not None:
			db.update_run(
				run_id,
				status='failed',
				error=error,
				finished_at=finished,
				duration_s=duration,
			)
			db.add_event(run_id, 'lifecycle', error, level='error')
			return

		if result is None:
			db.update_run(
				run_id,
				status='failed',
				error='The engine returned no result.',
				finished_at=finished,
				duration_s=duration,
			)
			db.add_event(run_id, 'lifecycle', 'The engine returned no result.', level='error')
			return

		status = {
			'completed': 'completed',
			'timeout': 'timeout',
			'max_steps': 'max_steps',
			'error': 'failed',
		}.get(result.status, 'failed')
		text = config.redact(result.text or '')
		err = config.redact(result.error) if result.error else None
		usage = dict(result.usage or {})
		db.update_run(
			run_id,
			status=status,
			finished_at=finished,
			result_text=text or None,
			error=err,
			steps=result.steps,
			cost_usd=result.cost_usd,
			usage=usage,
			success=None if result.success is None else (1 if result.success else 0),
			duration_s=round(result.duration_s or duration, 2),
		)
		for download in result.downloads or []:
			db.add_event(
				run_id,
				'download',
				f'Downloaded file: {Path(download).name}',
				data={'name': Path(download).name},
			)
		if status == 'completed':
			db.add_event(
				run_id,
				'lifecycle',
				f'Run completed in {result.steps} model step(s) — {round(result.duration_s or duration, 1)}s.',
				data={'steps': result.steps, 'cost_usd': result.cost_usd},
			)
		else:
			db.add_event(
				run_id,
				'lifecycle',
				f'Run ended with status "{status}"' + (f': {err}' if err else '.'),
				level='warning' if status in ('timeout', 'max_steps') else 'error',
			)

	def _forget(self, run_id: str) -> None:
		with self._lock:
			self._active.pop(run_id, None)

	def _watch_screenshots(self, run_id: str, workspace: Path, stop: threading.Event) -> None:
		"""Copy screenshots the agent actually captured into the run's artifact folder."""
		source = workspace / '.browser-use' / 'screenshots'
		target = db.screenshot_dir(run_id)
		seen: set[str] = set()
		while not stop.is_set():
			try:
				if source.is_dir():
					for path in sorted(source.iterdir()):
						if path.suffix.lower() not in ('.jpg', '.jpeg', '.png'):
							continue
						if path.name in seen:
							continue
						seen.add(path.name)
						destination = target / path.name
						shutil.copy2(path, destination)
						label = f'Checkpoint {len(seen):02d}'
						db.add_screenshot(run_id, path.name, label, time.time())
						db.add_event(run_id, 'screenshot', label, data={'filename': path.name})
			except Exception:
				pass
			stop.wait(1.5)


manager = RunManager()
