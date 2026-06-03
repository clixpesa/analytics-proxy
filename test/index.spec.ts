import { SELF } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const validPayload = {
	events: [{ user_id: 'test123', event_type: 'test_event', time: 1396381378123 }],
};

const mockAmplitudeResponse = {
	code: 200,
	server_upload_time: 1780516501313,
	payload_size_bytes: 132,
	events_ingested: 1,
};

// Return a NEW Response on every call — Workers runtime can't reuse response bodies
const mockFetch = vi.fn(() =>
	Promise.resolve(
		new Response(JSON.stringify(mockAmplitudeResponse), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}),
	),
);

beforeEach(() => {
	mockFetch.mockClear();
	vi.stubGlobal('fetch', mockFetch);
});

describe('Method validation', () => {
	it('rejects GET requests with 405', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy');
		expect(res.status).toBe(405);
		expect(await res.text()).toBe('Method not allowed');
	});

	it('rejects PUT requests with 405', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy', { method: 'PUT' });
		expect(res.status).toBe(405);
	});

	it('handles OPTIONS preflight correctly', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy', { method: 'OPTIONS' });
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
		expect(res.headers.get('Access-Control-Allow-Headers')).toContain('x-origin-application');
	});
});

describe('Route validation', () => {
	it('returns 404 for unknown routes', async () => {
		const res = await SELF.fetch('http://localhost/unknown-route', { method: 'POST' });
		expect(res.status).toBe(404);
	});

	it('returns 404 for root path', async () => {
		const res = await SELF.fetch('http://localhost/', { method: 'POST' });
		expect(res.status).toBe(404);
	});
});

describe('Origin validation', () => {
	it('rejects requests without x-origin-application header', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(validPayload),
		});
		expect(res.status).toBe(403);
		expect(await res.text()).toBe('Forbidden');
	});

	it('rejects requests with unknown origin', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-origin-application': 'unknown-app',
			},
			body: JSON.stringify(validPayload),
		});
		expect(res.status).toBe(403);
	});

	it('accepts requests with allowed origin "mobile"', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-origin-application': 'mobile',
			},
			body: JSON.stringify(validPayload),
		});
		expect(res.status).toBe(200);
	});

	it('accepts requests with allowed origin "web"', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-origin-application': 'web',
			},
			body: JSON.stringify(validPayload),
		});
		expect(res.status).toBe(200);
	});
});

describe('Amplitude forwarding', () => {
	it('forwards events and returns Amplitude response', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-origin-application': 'mobile',
			},
			body: JSON.stringify(validPayload),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ code: 200, events_ingested: 1 });
	});
	it('injects api_key into the forwarded payload', async () => {
		let capturedBody: Record<string, unknown> | null = null;

		// Override mockFetch to capture what was sent to Amplitude
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				if (url.toString().includes('amplitude.com')) {
					capturedBody = JSON.parse(init?.body as string);
				}
				return new Response(JSON.stringify(mockAmplitudeResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}),
		);

		await SELF.fetch('http://localhost/v1/amplitude-proxy', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-origin-application': 'mobile',
			},
			body: JSON.stringify(validPayload),
		});

		expect(capturedBody).not.toBeNull();
		expect(capturedBody!.api_key).toBe('00000000000000000000000000000000');
		expect(capturedBody!.events).toEqual(validPayload.events);
	});

	it('sets CORS header on response', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-origin-application': 'mobile',
			},
			body: JSON.stringify(validPayload),
		});
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://clixpesa.com');
	});

	it('forwards Origin-Country from CF-IPCountry header', async () => {
		const res = await SELF.fetch('http://localhost/v1/amplitude-proxy', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-origin-application': 'mobile',
				'CF-IPCountry': 'KE',
			},
			body: JSON.stringify(validPayload),
		});
		expect(res.headers.get('Origin-Country')).toBe('KE');
	});
});
