export interface UploadParams {
	owner: string;
	repo: string;
	token: string;
	branchName?: string; // optional override; defaults to 'patch-picasso-images'
	pathInRepo: string; // e.g., .github/patch-picasso/123-456.png
	commitMessage: string;
	contentBase64: string; // base64-encoded file content (no data URL prefix)
}

const API_VERSION = '2022-11-28';

async function getJson<T>(url: string, token: string): Promise<T> {
	const res = await fetch(url, {
		headers: {
			'Authorization': `Bearer ${token}`,
			'Accept': 'application/vnd.github+json',
			'X-GitHub-Api-Version': API_VERSION
		}
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GET ${url} failed: ${res.status} ${res.statusText} - ${text}`);
	}
	return res.json() as Promise<T>;
}

async function postJson<T>(url: string, token: string, body: any): Promise<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Accept': 'application/vnd.github+json',
			'X-GitHub-Api-Version': API_VERSION,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`POST ${url} failed: ${res.status} ${res.statusText} - ${text}`);
	}
	return res.json() as Promise<T>;
}

async function putJson<T>(url: string, token: string, body: any): Promise<T> {
	const res = await fetch(url, {
		method: 'PUT',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Accept': 'application/vnd.github+json',
			'X-GitHub-Api-Version': API_VERSION,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`PUT ${url} failed: ${res.status} ${res.statusText} - ${text}`);
	}
	return res.json() as Promise<T>;
}

async function ensureImagesBranch(params: { owner: string; repo: string; token: string; branchName: string; }): Promise<void> {
	const { owner, repo, token, branchName } = params;
	const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

	// Check if branch exists
	try {
		await getJson(`${apiBase}/branches/${encodeURIComponent(branchName)}`, token);
		return;
	} catch (err: any) {
		// continue if 404
	}

	// Get default branch name
	const repoInfo = await getJson<{ default_branch: string }>(`${apiBase}`, token);
	const defaultBranch = repoInfo.default_branch;

	// Get SHA of default branch head
	const branchInfo = await getJson<{ commit: { sha: string } }>(`${apiBase}/branches/${encodeURIComponent(defaultBranch)}`, token);
	const headSha = branchInfo.commit.sha;

	// Create new branch ref
	await postJson(`${apiBase}/git/refs`, token, {
		ref: `refs/heads/${branchName}`,
		sha: headSha
	});
}

export async function uploadImageToImagesBranch(params: UploadParams): Promise<string> {
	const { owner, repo, token, pathInRepo, commitMessage, contentBase64 } = params;
	const branchName = params.branchName || process.env.PATCH_PICASSO_IMAGE_BRANCH || 'patch-picasso-images';
	const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

	await ensureImagesBranch({ owner, repo, token, branchName });

	// Try to get existing file SHA (if any)
	let existingSha: string | undefined;
	try {
		const existing = await getJson<{ sha: string }>(`${apiBase}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branchName)}`, token);
		existingSha = (existing as any)?.sha;
	} catch (err: any) {
		// 404 is fine; file does not exist
	}

	// Create or update the file in the images branch
	await putJson(`${apiBase}/contents/${encodeURIComponent(pathInRepo)}`, token, {
		message: commitMessage,
		content: contentBase64,
		branch: branchName,
		sha: existingSha
	});

	// Return raw URL to the file
	const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${encodeURIComponent(branchName)}/${pathInRepo}`;
	return rawUrl;
}