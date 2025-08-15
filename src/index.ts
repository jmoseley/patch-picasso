#!/usr/bin/env node

import OpenAI from 'openai';
import minimist from 'minimist';
import { generateText } from 'ai';
import { openai as openaiProvider } from '@ai-sdk/openai';
import { readFile } from 'fs/promises';

const MARKER = '<!-- patch-picasso -->';

function getEnv(name: string, required = true): string | undefined {
	const value = process.env[name];
	if (!value && required) {
		console.error(`[patch-picasso] Missing required env: ${name}`);
		process.exit(1);
	}
	return value;
}

function parseRepo(repo: string) {
	const [owner, name] = repo.split('/');
	if (!owner || !name) {
		throw new Error(`Invalid repo string: ${repo}`);
	}
	return { owner, name };
}

async function getEventPayload(): Promise<any | undefined> {
	try {
		const eventPath = process.env.GITHUB_EVENT_PATH;
		if (!eventPath) return undefined;
		const content = await readFile(eventPath, 'utf8');
		return JSON.parse(content);
	} catch {
		return undefined;
	}
}

async function fetchJson(url: string, token: string) {
	const res = await fetch(url, {
		headers: {
			'Authorization': `Bearer ${token}`,
			'Accept': 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub API ${url} failed: ${res.status} ${res.statusText} - ${text}`);
	}
	return res.json();
}

async function postJson(url: string, token: string, body: any) {
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Accept': 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub API POST ${url} failed: ${res.status} ${res.statusText} - ${text}`);
	}
	return res.json();
}

async function main() {
	const args = minimist(process.argv.slice(2));

	const githubToken = getEnv('GITHUB_TOKEN');
	const openaiKey = getEnv('OPENAI_API_KEY');
	if (!githubToken || !openaiKey) return; // getEnv will exit if missing

	const event = await getEventPayload();
	const repoArg: string | undefined = args.repo || process.env.GITHUB_REPOSITORY;
	if (!repoArg) {
		console.error('[patch-picasso] Missing repo. Pass --repo owner/repo or set GITHUB_REPOSITORY.');
		process.exit(1);
	}
	const { owner, name: repo } = parseRepo(repoArg);

	let prNumber: number | undefined = args.pr || args['pr-number'];
	if (!prNumber && event && event.pull_request && event.pull_request.number) {
		prNumber = event.pull_request.number;
	}
	if (!prNumber) {
		console.error('[patch-picasso] Missing PR number. Pass --pr or ensure this runs on a pull_request event.');
		process.exit(1);
	}

	const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

	const pr = await fetchJson(`${apiBase}/pulls/${prNumber}`, githubToken);
	const files = await fetchJson(`${apiBase}/pulls/${prNumber}/files?per_page=100`, githubToken);

	// Check if already commented
	const comments = await fetchJson(`${apiBase}/issues/${prNumber}/comments?per_page=100`, githubToken);
	const existing = (comments as any[]).find(c => typeof c.body === 'string' && c.body.includes(MARKER));
	if (existing) {
		console.log('[patch-picasso] Comment already exists. Skipping.');
		return;
	}

	const changedFiles = (files as any[]).map(f => `${f.status}: ${f.filename}`).slice(0, 30);
	const prSummary = [
		`Title: ${pr.title}`,
		pr.body ? `Body: ${pr.body.substring(0, 2000)}` : 'Body: (none)',
		`Author: ${pr.user?.login}`,
		`Base: ${pr.base?.ref}`,
		`Head: ${pr.head?.ref}`,
		`Files:`,
		...changedFiles
	].join('\n');

	// Use Vercel AI SDK to craft a concise, humorous image prompt and caption
	const promptSystem = [
		'You are a witty prompt engineer who writes funny, vivid scene descriptions for an image generation model.',
		'Constraints:',
		'- Keep the image prompt under 120 words.',
		'- Keep the style playful and safe-for-work.',
		'- Avoid logos, trademarks, and real person likenesses.',
		'- Prefer cartoony styles. Include specific visual details relevant to the PR.\n'
	].join('\n');

	const promptUser = [
		'Create:',
		'1) An IMAGE PROMPT: a funny scene inspired by this PR.',
		'2) A CAPTION: one short witty line for the comment.',
		'',
		'PR DETAILS:\n' + prSummary,
		'',
		'Output JSON with keys imagePrompt and caption.'
	].join('\n');

	const { text: structured } = await generateText({
		model: openaiProvider('gpt-4o-mini') as any,
		system: promptSystem,
		prompt: promptUser,
		maxTokens: 400
	});

	let imagePrompt = '';
	let caption = '';
	try {
		const parsed = JSON.parse(structured);
		imagePrompt = String(parsed.imagePrompt || '').slice(0, 800);
		caption = String(parsed.caption || '').slice(0, 200);
	} catch {
		// Fallback: use raw text as prompt
		imagePrompt = structured.slice(0, 800);
		caption = 'A lighthearted take on this PR';
	}

	const openai = new OpenAI({ apiKey: openaiKey });
	const image = await openai.images.generate({
		model: 'gpt-image-1',
		prompt: imagePrompt,
		size: '1024x1024'
	});

	let imageUrl: string | undefined = image.data?.[0]?.url;
	if (!imageUrl) {
		const b64 = image.data?.[0]?.b64_json;
		if (b64) {
			imageUrl = `data:image/png;base64,${b64}`;
		}
	}
	if (!imageUrl) {
		throw new Error('OpenAI did not return an image URL or data');
	}

	const body = [
		MARKER,
		'\n',
		caption ? `> ${caption}\n` : '',
		'',
		`![Funny PR Image](${imageUrl})`,
		'',
		'<sub>Generated by patch-picasso using Vercel AI SDK and OpenAI.</sub>'
	].join('\n');

	await postJson(`${apiBase}/issues/${prNumber}/comments`, githubToken, { body });
	console.log('[patch-picasso] Comment posted.');
}

main().catch((err) => {
	console.error('[patch-picasso] Failed:', err?.message || err);
	process.exit(1);
});