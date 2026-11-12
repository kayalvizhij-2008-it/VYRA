"""API and safety tests for VYRA.

The suite never launches a browser or calls a model provider: `manager.start`
is stubbed and capability detection is replaced with a deterministic snapshot.
What is exercised is the real request validation, persistence, redaction and
lifecycle bookkeeping the UI depends on.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient


def _snapshot(tmp_path) -> dict[str, Any]:
	return {
		'engine': {
			'package': 'browser-use',
			'version': '1.0.2',
			'installed': True,
			'upstream': 'upstream/browser-use',
			'commit': 'abc1234',
			'license': True,
		},
		'python': '3.13.0',
		'providers': [
			{
				'id': 'openai',
				'label': 'OpenAI',
				'configured': True,
				'missing_env': [],
				'models': ['gpt-test'],
				'default_model': 'gpt-test',
				'note': 'test provider',
			},
			{
				'id': 'anthropic',
				'label': 'Anthropic',
				'configured': False,
				'missing_env': ['ANTHROPIC_API_KEY'],
				'models': ['claude-test'],
				'default_model': 'claude-test',
				'note': 'not configured',
			},
		],
		'browsers': [{'id': 'chrome', 'label': 'Google Chrome', 'available': True, 'executable': 'chrome.exe'}],
		'cloud_browser': {'available': False, 'env': 'BROWSER_USE_API_KEY', 'billed': True},
		'env_present': {'OPENAI_API_KEY': True, 'ANTHROPIC_API_KEY': False},
		'data_dir': str(tmp_path),
		'limits': {
			'max_active_runs': 2,
			'default_max_steps': 60,
			'default_timeout_s': 600,
			'default_headless': True,
		},
	}


@pytest.fixture()
def client(tmp_path, monkeypatch):
	from vyra import config
	from vyra.runner import manager

	monkeypatch.setattr(config, 'DATA_DIR', tmp_path)
	monkeypatch.setattr(config, 'DB_PATH', tmp_path / 'vyra.sqlite3')
	monkeypatch.setattr(config, 'WORKSPACES_DIR', tmp_path / 'workspaces')
	monkeypatch.setattr(config, 'SCREENSHOTS_DIR', tmp_path / 'screenshots')
	monkeypatch.setattr(config, 'MAX_ACTIVE_RUNS', 2)

	snapshot = _snapshot(tmp_path)
	monkeypatch.setattr(config, 'setup_snapshot', lambda: snapshot)
	monkeypatch.setattr(
		config,
		'provider_status',
		lambda provider: {
			'id': provider['id'],
			'label': provider['label'],
			'configured': provider['id'] == 'openai',
			'missing_env': [] if provider['id'] == 'openai' else provider['env_keys'],
			'models': provider['models'],
			'default_model': provider['default_model'],
			'note': provider['note'],
		},
	)
	monkeypatch.setattr(manager, 'start', lambda run_id: None)

	from vyra.app import app

	with TestClient(app) as test_client:
		yield test_client, config


def _payload(**overrides: Any) -> dict[str, Any]:
	data: dict[str, Any] = {
		'task': 'Open https://example.com and report the page title.',
		'provider': 'openai',
		'model': 'gpt-test',
		'browser_mode': 'local',
		'headless': True,
		'allowed_domains': [],
		'prohibited_domains': [],
		'max_steps': 5,
		'timeout_s': 120,
		'acknowledge_risk': False,
	}
	data.update(overrides)
	return data


def test_health_and_setup(client):
	http, _config = client
	health = http.get('/api/health')
	assert health.status_code == 200
	assert health.json()['engine_installed'] is True

	setup = http.get('/api/setup')
	assert setup.status_code == 200
	body = setup.json()
	assert body['engine']['version'] == '1.0.2'
	assert body['providers'][0]['configured'] is True


def test_create_run_is_queued_and_logged(client):
	http, config = client
	response = http.post('/api/runs', json=_payload())
	assert response.status_code == 201, response.text
	run = response.json()
	assert run['status'] == 'queued'
	assert run['provider'] == 'openai'
	assert run['risk_flags'] == []

	stored = config.__dict__  # keep the import used
	assert stored is not None

	events = http.get(f"/api/runs/{run['id']}/events").json()['events']
	assert any(event['kind'] == 'lifecycle' for event in events)

	detail = http.get(f"/api/runs/{run['id']}")
	assert detail.status_code == 200
	assert detail.json()['task'] == _payload()['task']


def test_high_impact_task_requires_acknowledgement(client):
	http, _config = client
	blocked = http.post('/api/runs', json=_payload(task='Buy a laptop on example.com'))
	assert blocked.status_code == 422
	detail = blocked.json()['detail']
	assert detail['code'] == 'confirmation_required'
	assert 'buy' in detail['flags']

	allowed = http.post('/api/runs', json=_payload(task='Buy a laptop on example.com', acknowledge_risk=True))
	assert allowed.status_code == 201
	assert 'buy' in allowed.json()['risk_flags']


def test_unconfigured_provider_is_refused(client, monkeypatch):
	http, config = client
	monkeypatch.setattr(
		config,
		'provider_status',
		lambda provider: {
			'id': provider['id'],
			'label': provider['label'],
			'configured': False,
			'missing_env': ['OPENAI_API_KEY'],
			'models': provider['models'],
			'default_model': provider['default_model'],
			'note': provider['note'],
		},
	)
	response = http.post('/api/runs', json=_payload())
	assert response.status_code == 422
	assert response.json()['detail']['code'] == 'provider_not_configured'
	assert response.json()['detail']['missing_env'] == ['OPENAI_API_KEY']


def test_domain_validation_rejects_urls_and_overlap(client):
	http, _config = client
	bad = http.post('/api/runs', json=_payload(allowed_domains=['https://example.com/path']))
	assert bad.status_code == 422
	assert 'invalid domain pattern' in bad.json()['detail']

	overlap = http.post('/api/runs', json=_payload(allowed_domains=['a.com'], prohibited_domains=['a.com']))
	assert overlap.status_code == 422
	assert 'both allowed and prohibited' in overlap.json()['detail']


def test_cloud_browser_requires_key(client):
	http, _config = client
	response = http.post('/api/runs', json=_payload(browser_mode='cloud'))
	assert response.status_code == 422
	assert response.json()['detail']['code'] == 'browser_not_configured'


def test_cancel_queued_run_and_conflict(client):
	http, _config = client
	run = http.post('/api/runs', json=_payload()).json()
	cancel = http.post(f"/api/runs/{run['id']}/cancel")
	assert cancel.status_code == 200
	assert cancel.json()['status'] == 'cancelled'

	again = http.post(f"/api/runs/{run['id']}/cancel")
	assert again.status_code == 409


def test_retry_creates_a_new_run(client):
	http, _config = client
	run = http.post('/api/runs', json=_payload()).json()
	retry = http.post(f"/api/runs/{run['id']}/retry")
	assert retry.status_code == 201
	assert retry.json()['id'] != run['id']
	assert retry.json()['status'] == 'queued'


def test_unknown_run_returns_404(client):
	http, _config = client
	assert http.get('/api/runs/missing').status_code == 404
	assert http.get('/api/runs/missing/events').status_code == 404


def test_redaction_removes_tokens_and_env_secrets(monkeypatch):
	from vyra import config

	assert config.redact('token sk-abcdefghijklmnopqrstuvwx') == 'token [redacted]'
	assert config.redact('Authorization: Bearer abcdefghijklmnop') == 'Authorization: [redacted]'

	monkeypatch.setenv('VYRA_TEST_SECRET', 'super-secret-value-123')
	assert 'super-secret-value-123' not in config.redact('value super-secret-value-123 end')
	assert config.redact('value super-secret-value-123 end') == 'value [redacted] end'


def test_templates_crud(client):
	http, _config = client
	builtin = http.get('/api/templates').json()
	assert builtin and builtin[0]['built_in'] == 1

	created = http.post('/api/templates', json={'title': 'My scan', 'prompt': 'Open example.com and list headings.', 'category': 'Custom'})
	assert created.status_code == 201
	template_id = created.json()['id']

	assert http.delete(f'/api/templates/{template_id}').json() == {'deleted': True}
	assert http.delete(f"/api/templates/{template_id}").status_code == 404
	assert http.delete(f"/api/templates/{builtin[0]['id']}").status_code == 404


def test_screenshot_serving(client):
	http, config = client
	run = http.post('/api/runs', json=_payload()).json()
	run_id = run['id']
	directory = config.SCREENSHOTS_DIR / run_id
	directory.mkdir(parents=True)
	image = directory / '0001.jpg'
	image.write_bytes(b'\xff\xd8\xff\xe0fake-jpeg')

	response = http.get(f'/api/runs/{run_id}/screenshots/0001.jpg')
	assert response.status_code == 200
	assert response.headers['content-type'].startswith('image/jpeg')

	assert http.get(f'/api/runs/{run_id}/screenshots/nope.jpg').status_code == 404
