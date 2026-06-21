/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	AMPLITUDE_API_KEY: string;
	ALLOWED_ORIGINS: string;
	ALLOWED_ORIGIN: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return handleCors(env);
		}

		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 });
		}

		const url = new URL(request.url);

		if (url.pathname === '/v1/amplitude-proxy') {
			return forwardToAmplitude(request, env);
		}

		return new Response('Not found', { status: 404 });
	},
};

async function forwardToAmplitude(request: Request, env: Env): Promise<Response> {
	// Validate x-origin-application header sent by ApplicationTransport
	const appOrigin = request.headers.get('x-origin-application');
	const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());

	if (!appOrigin || !allowedOrigins.includes(appOrigin)) {
		console.warn(JSON.stringify({ reason: 'forbidden_origin', appOrigin, allowedOrigins }));
		return new Response('Forbidden', { status: 403 });
	}

	const body = (await request.json()) as Record<string, unknown>;

	const payload = {
		...body,
		api_key: env.AMPLITUDE_API_KEY,
	};

	const response = await fetch('https://api2.amplitude.com/2/httpapi', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});

	const responseBody = (await response.json()) as Record<string, unknown>;

	if (!response.ok) {
		console.warn(
			JSON.stringify({
				reason: 'amplitude_rejected',
				upstreamStatus: response.status,
				amplitudeCode: responseBody.code,
				error: responseBody.error,
				missingField: responseBody.missing_field,
			}),
		);
	}

	// Cloudflare provides CF-IPCountry — forward as Origin-Country
	// ApplicationTransport reads this to call reportOriginCountry()
	const country = request.headers.get('CF-IPCountry');

	return new Response(JSON.stringify(responseBody), {
		status: response.status,
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
			...(country && { 'Origin-Country': country }),
		},
	});
}

function handleCors(env: Env): Response {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Accept, x-origin-application, x-application-build, Origin',
		},
	});
}
