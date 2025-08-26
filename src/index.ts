import OpenAI from 'openai';
import * as gensx from '@gensx/core';
import { generateText } from '@gensx/vercel-ai';
import { openai as openaiProvider } from '@ai-sdk/openai';
import { uploadImageToImagesBranch } from './imageStorage.js';

const MARKER = '<!-- patch-picasso -->';

function parseRepo(repo: string) {
	const [owner, name] = repo.split('/');
	if (!owner || !name) {
		throw new Error(`Invalid repo string: ${repo}`);
	}
	return { owner, name };
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

export interface PatchPicassoInput {
	githubToken: string;
	openaiApiKey: string;
	repo: string; // owner/repo
	prNumber: number;
	imageBranch?: string;
}

interface GeneratePromptOutput {
	imagePrompt: string;
	caption: string;
}

const FetchPRDetails = gensx.Component<
	{ githubToken: string; owner: string; repo: string; prNumber: number },
	{ apiBase: string; pr: any; files: any[]; hasExistingComment: boolean }
>(
	'FetchPRDetails',
	async ({ githubToken, owner, repo, prNumber }) => {
		const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
		const pr = await fetchJson(`${apiBase}/pulls/${prNumber}`, githubToken);
		const files = await fetchJson(`${apiBase}/pulls/${prNumber}/files?per_page=100`, githubToken) as any[];
		const comments = await fetchJson(`${apiBase}/issues/${prNumber}/comments?per_page=100`, githubToken);
		const existing = (comments as any[]).find(c => typeof c.body === 'string' && c.body.includes(MARKER));
		return { apiBase, pr, files, hasExistingComment: Boolean(existing) };
	}
);

const GeneratePrompt = gensx.Component<
	{ pr: any; files: any[] },
	GeneratePromptOutput
>(
	'GeneratePrompt',
	async ({ pr, files }) => {
		const changedFiles = (files as any[]).map((f: any) => `${f.status}: ${f.filename}`).slice(0, 30);
		const prSummary = [
			`Title: ${pr.title}`,
			pr.body ? `Body: ${String(pr.body).substring(0, 2000)}` : 'Body: (none)',
			`Author: ${pr.user?.login}`,
			`Base: ${pr.base?.ref}`,
			`Head: ${pr.head?.ref}`,
			`Files:`,
			...changedFiles
		].join('\n');

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
			imagePrompt = structured.slice(0, 800);
			caption = 'A lighthearted take on this PR';
		}

		return { imagePrompt, caption };
	}
);

const GenerateImage = gensx.Component<
	{ openaiApiKey: string; imagePrompt: string },
	{ b64?: string; url?: string }
>(
	'GenerateImage',
	async ({ openaiApiKey, imagePrompt }) => {
		const client = new OpenAI({ apiKey: openaiApiKey });
		const image = await client.images.generate({
			model: 'gpt-image-1',
			prompt: imagePrompt,
			size: '1024x1024'
		});
		return { b64: image.data?.[0]?.b64_json as string | undefined, url: image.data?.[0]?.url as string | undefined };
	}
);

const UploadImage = gensx.Component<
	{ owner: string; repo: string; token: string; prNumber: number; b64?: string; url?: string; imageBranch?: string },
	{ finalImageUrl?: string }
>(
	'UploadImage',
	async ({ owner, repo, token, prNumber, b64, url, imageBranch }) => {
		let finalImageUrl: string | undefined;
		const now = Date.now();
		const imgPath = `.github/patch-picasso/${prNumber}-${now}.png`;
		const branchOverride = imageBranch || undefined;

		if (b64) {
			try {
				finalImageUrl = await uploadImageToImagesBranch({
					owner,
					repo,
					token,
					pathInRepo: imgPath,
					commitMessage: `patch-picasso: add generated image for PR #${prNumber}`,
					contentBase64: b64,
					branchName: branchOverride
				});
			} catch (e) {
				// fall through to try URL fetch path
			}
		}

		if (!finalImageUrl && url) {
			try {
				const response = await fetch(url);
				if (response.ok) {
					const arrayBuffer = await response.arrayBuffer();
					const buffer = Buffer.from(arrayBuffer);
					const contentBase64 = buffer.toString('base64');
					finalImageUrl = await uploadImageToImagesBranch({
						owner,
						repo,
						token,
						pathInRepo: imgPath,
						commitMessage: `patch-picasso: add generated image for PR #${prNumber}`,
						contentBase64,
						branchName: branchOverride
					});
				}
			} catch (e) {
				// ignore and return undefined
			}
		}

		return { finalImageUrl };
	}
);

const PostComment = gensx.Component<
	{ apiBase: string; githubToken: string; prNumber: number; caption: string; finalImageUrl?: string },
	{ posted: boolean }
>(
	'PostComment',
	async ({ apiBase, githubToken, prNumber, caption, finalImageUrl }) => {
		const safeCaption = caption.slice(0, 500);
		const body = [
			MARKER,
			'\n',
			safeCaption ? `> ${safeCaption}\n` : '',
			finalImageUrl ? `\n![Funny PR Image](${finalImageUrl})\n` : '\n(Generated image unavailable)\n',
			'<sub>Generated by patch-picasso using Vercel AI SDK and OpenAI.</sub>'
		].join('\n');
		await postJson(`${apiBase}/issues/${prNumber}/comments`, githubToken, { body });
		return { posted: true };
	}
);

type PatchPicassoOutput = { skipped: boolean; reason?: string; finalImageUrl?: string; caption?: string; imagePrompt?: string };

const PatchPicassoImpl = gensx.Component<PatchPicassoInput, PatchPicassoOutput>(
	'PatchPicassoImpl',
	async ({ githubToken, openaiApiKey, repo, prNumber, imageBranch }) => {
		const { owner, name } = parseRepo(repo);
		const details = await FetchPRDetails.run({ githubToken, owner, repo: name, prNumber });
		if (details.hasExistingComment) {
			return { skipped: true, reason: 'Comment already exists' };
		}

		const promptOut = await GeneratePrompt.run({ pr: details.pr, files: details.files });
		const img = await GenerateImage.run({ openaiApiKey, imagePrompt: promptOut.imagePrompt });
		const uploaded = await UploadImage.run({ owner, repo: name, token: githubToken, prNumber, b64: img.b64, url: img.url, imageBranch });
		await PostComment.run({ apiBase: details.apiBase, githubToken, prNumber, caption: promptOut.caption, finalImageUrl: uploaded.finalImageUrl });
		return { skipped: false, finalImageUrl: uploaded.finalImageUrl, caption: promptOut.caption, imagePrompt: promptOut.imagePrompt };
	}
);

export const PatchPicasso = gensx.Workflow<PatchPicassoInput, PatchPicassoOutput>('PatchPicasso', PatchPicassoImpl);

