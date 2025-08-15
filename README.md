# patch-picasso

Paints a witty image for your Pull Request and posts it as a comment — self-contained in a GitHub Action using `npx`, Vercel AI SDK, and OpenAI.

## What it does
- Reads PR details (title, body, changed files)
- Crafts a humorous image prompt with Vercel AI SDK
- Generates an image via OpenAI (`gpt-image-1`)
- Posts the image as a PR comment
- Skips if it already commented on the PR

## Requirements
- Node.js 18+ in your GitHub Action runner
- `GITHUB_TOKEN` (provided automatically by GitHub Actions)
- `OPENAI_API_KEY` (you provide)

## Quick Start (GitHub Actions)
Copy this workflow into your repo at `.github/workflows/patch-picasso.yml`:

```yaml
name: Patch Picasso

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  patch-picasso:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Post witty image to PR
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          npx --yes patch-picasso \
            --repo "${{ github.repository }}" \
            --pr "${{ github.event.pull_request.number }}"
```

## Inputs
- `--repo`: `owner/repo` (defaults to `GITHUB_REPOSITORY`)
- `--pr` or `--pr-number`: pull request number (auto-detected on `pull_request` events)

## How it works
- Uses GitHub REST API with `GITHUB_TOKEN` to read PR details and post a comment
- Uses Vercel AI SDK (`ai`, `@ai-sdk/openai`) to synthesize a witty image prompt and caption
- Uses OpenAI Images (`gpt-image-1`) to generate an image and embeds its URL in the comment
- If only base64 is returned, uploads the image into the PR head branch using the GitHub Contents API and links to the raw file (requires `contents: write` and PR from the same repo)
- Adds a hidden marker to detect if it has already commented, ensuring idempotency

## Environment Variables
- `GITHUB_TOKEN`: Provided automatically by GitHub Actions. Needed for GitHub API calls
- `OPENAI_API_KEY`: Your OpenAI API key. Add as a repository secret named `OPENAI_API_KEY`

## Local test
```bash
npm install
npm run build
GITHUB_TOKEN=ghp_example OPENAI_API_KEY=sk-example \
node dist/index.js --repo your-org/your-repo --pr 123
```

## Notes
- Forked PRs cannot receive uploaded images to the base repo by default; the fallback upload is skipped
- No GitHub App is required; everything uses the standard `GITHUB_TOKEN`

## License
MIT
