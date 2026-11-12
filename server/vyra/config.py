"""Server-side configuration and capability detection for VYRA.

Everything here is derived from the real environment: which model providers have
credentials present, which local Chromium-family browsers can be launched, and
which version/commit of the upstream ``browser-use`` engine is installed. No
secret value is ever returned to the client; only presence and names.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM_DIR = ROOT / 'upstream' / 'browser-use'

# Load server/.env for local development. Real environment variables (Render,
# Docker, a shell export) always take precedence because override=False.
try:
	from dotenv import load_dotenv

	load_dotenv(ROOT / 'server' / '.env', override=False)
except Exception:
	# The app still works with process environment variables only.
	pass


def _data_dir() -> Path:
    raw = os.environ.get('VYRA_DATA_DIR')
    path = Path(raw).expanduser() if raw else ROOT / 'data'
    return path.resolve()


DATA_DIR = _data_dir()
WORKSPACES_DIR = DATA_DIR / 'workspaces'
SCREENSHOTS_DIR = DATA_DIR / 'screenshots'
DB_PATH = DATA_DIR / 'vyra.sqlite3'

MAX_ACTIVE_RUNS = int(os.environ.get('VYRA_MAX_ACTIVE_RUNS', '2'))
DEFAULT_MAX_STEPS = int(os.environ.get('VYRA_DEFAULT_MAX_STEPS', '60'))
DEFAULT_TIMEOUT_S = int(os.environ.get('VYRA_DEFAULT_TIMEOUT_S', '600'))
DEFAULT_HEADLESS = os.environ.get('VYRA_DEFAULT_HEADLESS', 'true').lower() != 'false'

# --- providers -----------------------------------------------------------------
# Each provider maps to a real browser-use 1.0 LLM class. A provider is only
# offered when its credential is present in the server environment.
PROVIDERS: list[dict[str, Any]] = [
	{
		'id': 'browser-use',
		'label': 'Browser Use gateway',
		'env_keys': ['BROWSER_USE_API_KEY'],
		'models': ['bu-fast', 'bu-ultrafast', 'bu-smart'],
		'default_model': 'bu-fast',
		'note': 'Model inference (and the cloud browser it defaults to) is billed to your Browser Use account.',
		'kind': 'gateway',
	},
	{
		'id': 'openai',
		'label': 'OpenAI',
		'env_keys': ['OPENAI_API_KEY'],
		'models': [os.environ.get('VYRA_OPENAI_MODEL', 'gpt-6-luna')],
		'default_model': os.environ.get('VYRA_OPENAI_MODEL', 'gpt-6-luna'),
		'note': 'Billed by OpenAI per token. The model string is editable in Advanced options.',
		'kind': 'openai',
	},
	{
		'id': 'anthropic',
		'label': 'Anthropic',
		'env_keys': ['ANTHROPIC_API_KEY'],
		'models': [os.environ.get('VYRA_ANTHROPIC_MODEL', 'claude-sonnet-4-5')],
		'default_model': os.environ.get('VYRA_ANTHROPIC_MODEL', 'claude-sonnet-4-5'),
		'note': 'Billed by Anthropic per token. The model string is editable in Advanced options.',
		'kind': 'anthropic',
	},
	{
		'id': 'google',
		'label': 'Google Gemini',
		'env_keys': ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
		'models': [os.environ.get('VYRA_GOOGLE_MODEL', 'gemini-2.5-flash')],
		'default_model': os.environ.get('VYRA_GOOGLE_MODEL', 'gemini-2.5-flash'),
		'note': 'Billed by Google per token. The model string is editable in Advanced options.',
		'kind': 'google',
	},
	{
		'id': 'compatible',
		'label': 'OpenAI-compatible endpoint',
		'env_keys': ['VYRA_OPENAI_API_KEY', 'VYRA_OPENAI_BASE_URL'],
		'models': [os.environ.get('VYRA_COMPATIBLE_MODEL', 'local-model')],
		'default_model': os.environ.get('VYRA_COMPATIBLE_MODEL', 'local-model'),
		'note': 'Any OpenAI-compatible chat server (Ollama, vLLM, a gateway). Costs depend on that server.',
		'kind': 'compatible',
	},
]

PROVIDER_IDS = {p['id'] for p in PROVIDERS}

BROWSER_MODES = [
	{
		'id': 'local',
		'label': 'Local Chromium',
		'description': 'A fresh Chrome/Chromium/Edge with its own temporary profile, deleted after the run.',
		'persistent': False,
	},
	{
		'id': 'attached',
		'label': 'Attached Chrome',
		'description': "Drives the Chrome you already have open, with its logins (enable chrome://inspect remote debugging once).",
		'persistent': True,
	},
	{
		'id': 'cloud',
		'label': 'Browser Use Cloud',
		'description': 'A hosted stealth browser; requires a Browser Use key and is billed per browser-hour.',
		'persistent': False,
	},
]

RISK_TERMS = [
	'buy',
	'purchase',
	'checkout',
	'payment',
	'pay ',
	'transfer',
	'delete account',
	'cancel subscription',
	'send email',
	'send message',
	'post ',
	'publish',
	'subscribe',
	'book ',
	'sign the contract',
	'place order',
]


def provider_status(provider: dict[str, Any]) -> dict[str, Any]:
	env = provider['env_keys']
	missing = [name for name in env if not os.environ.get(name)]
	return {
		'id': provider['id'],
		'label': provider['label'],
		'configured': not missing,
		'env_keys': list(env),
		'missing_env': missing,
		'models': provider['models'],
		'default_model': provider['default_model'],
		'note': provider['note'],
	}


def _browser_candidates() -> list[dict[str, Any]]:
	candidates: list[dict[str, Any]] = []
	if sys.platform == 'win32':
		bases = [
			os.environ.get('PROGRAMFILES', r'C:\Program Files'),
			os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)'),
			os.environ.get('LOCALAPPDATA', ''),
		]
		rel = [
			('chrome', 'Google Chrome', Path('Google/Chrome/Application/chrome.exe')),
			('edge', 'Microsoft Edge', Path('Microsoft/Edge/Application/msedge.exe')),
		]
		for kind, label, tail in rel:
			for base in filter(None, bases):
				candidates.append({'id': kind, 'label': label, 'path': Path(base) / tail})
	elif sys.platform == 'darwin':
		candidates += [
			{'id': 'chrome', 'label': 'Google Chrome', 'path': Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')},
			{'id': 'edge', 'label': 'Microsoft Edge', 'path': Path('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')},
			{'id': 'chromium', 'label': 'Chromium', 'path': Path('/Applications/Chromium.app/Contents/MacOS/Chromium')},
		]
	else:
		for kind, label, cmd in [
			('chrome', 'Google Chrome', 'google-chrome'),
			('chromium', 'Chromium', 'chromium'),
			('chromium', 'Chromium (chromium-browser)', 'chromium-browser'),
			('edge', 'Microsoft Edge', 'microsoft-edge'),
		]:
			found = shutil.which(cmd)
			if found:
				candidates.append({'id': kind, 'label': label, 'path': Path(found)})

	seen: set[str] = set()
	result: list[dict[str, Any]] = []
	for c in candidates:
		key = str(c['path']).lower()
		if key in seen:
			continue
		seen.add(key)
		if c['path'].exists():
			result.append({'id': c['id'], 'label': c['label'], 'available': True, 'executable': c['path'].name})
	return result


def _git_commit() -> str | None:
	try:
		out = subprocess.run(
			['git', '-C', str(UPSTREAM_DIR), 'rev-parse', '--short', 'HEAD'],
			capture_output=True,
			text=True,
			timeout=5,
		)
		return out.stdout.strip() or None
	except Exception:
		return None


def _engine_version() -> str | None:
	try:
		import browser_use

		return str(browser_use.__version__)
	except Exception:
		return None


def setup_snapshot() -> dict[str, Any]:
	browsers = _browser_candidates()
	providers = [provider_status(p) for p in PROVIDERS]
	keys = ['BROWSER_USE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']
	return {
		'engine': {
			'package': 'browser-use',
			'version': _engine_version(),
			'installed': _engine_version() is not None,
			'upstream': str(UPSTREAM_DIR.relative_to(ROOT)) if UPSTREAM_DIR.exists() else None,
			'commit': _git_commit(),
			'license': (UPSTREAM_DIR / 'LICENSE').exists(),
		},
		'python': sys.version.split()[0],
		'providers': providers,
		'browsers': browsers,
		'cloud_browser': {
			'available': bool(os.environ.get('BROWSER_USE_API_KEY')),
			'env': 'BROWSER_USE_API_KEY',
			'billed': True,
		},
		'env_present': {k: bool(os.environ.get(k)) for k in keys},
		'data_dir': str(DATA_DIR),
		'limits': {
			'max_active_runs': MAX_ACTIVE_RUNS,
			'default_max_steps': DEFAULT_MAX_STEPS,
			'default_timeout_s': DEFAULT_TIMEOUT_S,
			'default_headless': DEFAULT_HEADLESS,
		},
	}


# --- redaction -----------------------------------------------------------------
_SECRET_ENV_RE = re.compile(r'(API_KEY|TOKEN|SECRET|PASSWORD)$', re.I)
_TOKEN_PATTERNS = [
	re.compile(r'\bsk-[A-Za-z0-9_\-]{10,}'),
	re.compile(r'\bbu_[A-Za-z0-9_\-]{10,}'),
	re.compile(r'\bBearer\s+[A-Za-z0-9._\-]{10,}', re.I),
]


def _secret_values() -> list[str]:
	values = []
	for name, value in os.environ.items():
		if _SECRET_ENV_RE.search(name) and value and len(value) >= 8:
			values.append(value)
	return sorted(set(values), key=len, reverse=True)


def redact(text: str) -> str:
	if not text:
		return text
	for value in _secret_values():
		text = text.replace(value, '[redacted]')
	for pattern in _TOKEN_PATTERNS:
		text = pattern.sub('[redacted]', text)
	return text


def risk_flags(task: str) -> list[str]:
	lowered = f' {task.lower()} '
	return [term.strip() for term in RISK_TERMS if term in lowered]


# --- LLM + browser construction ------------------------------------------------
def resolve_provider(provider_id: str) -> dict[str, Any]:
	for p in PROVIDERS:
		if p['id'] == provider_id:
			return p
	raise ValueError(f'Unknown provider {provider_id!r}.')


def build_llm(provider_id: str, model: str):
	"""Return the real browser-use chat model for a provider, or raise ValueError."""
	provider = resolve_provider(provider_id)
	status = provider_status(provider)
	if not status['configured']:
		raise ValueError(
			f'{provider["label"]} is not configured. Set {", ".join(status["missing_env"])} in server/.env and restart.'
		)
	kind = provider['kind']
	name = model or provider['default_model']
	if kind == 'gateway':
		from browser_use import ChatBrowserUse

		return ChatBrowserUse(name)
	if kind == 'openai':
		from browser_use import ChatOpenAI

		return ChatOpenAI(name)
	if kind == 'anthropic':
		from browser_use import ChatAnthropic

		return ChatAnthropic(name)
	if kind == 'google':
		from browser_use import ChatGoogle

		return ChatGoogle(name)
	if kind == 'compatible':
		from browser_use import ChatOpenAI

		base_url = os.environ.get('VYRA_OPENAI_BASE_URL', '').strip()
		api_key = os.environ.get('VYRA_OPENAI_API_KEY', '').strip()
		if not base_url:
			raise ValueError('Set VYRA_OPENAI_BASE_URL for the OpenAI-compatible provider.')
		return ChatOpenAI(name, base_url=base_url, api_key=api_key or 'not-needed')
	raise ValueError(f'Unsupported provider kind {kind!r}.')


def build_browser(mode: str, *, headless: bool, allowed: list[str], prohibited: list[str]):
	from browser_use import Browser

	kwargs: dict[str, Any] = {}
	if allowed:
		kwargs['allowed_domains'] = allowed
	if prohibited:
		kwargs['prohibited_domains'] = prohibited
	if mode == 'local':
		return Browser('chromium', headless=headless, **kwargs)
	if mode == 'attached':
		return Browser('chrome', **kwargs)
	if mode == 'cloud':
		if not os.environ.get('BROWSER_USE_API_KEY'):
			raise ValueError('Browser Use Cloud needs BROWSER_USE_API_KEY in server/.env.')
		return Browser(**kwargs)
	raise ValueError(f'Unknown browser mode {mode!r}.')
