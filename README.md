# pr-funny-image-bot

Generate a funny image for a Pull Request and post it as a comment — all from a self-contained GitHub Action using `npx`, Vercel AI SDK, and OpenAI.

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
Copy this workflow into your repo at `.github/workflows/funny-pr-image.yml`:

```yaml
name: Funny PR Image

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  funny-image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Post funny image to PR
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          npx --yes -p github:YOUR_ORG/YOUR_REPO@main pr-funny-image \
            --repo "${{ github.repository }}" \
            --pr "${{ github.event.pull_request.number }}"
```

Replace `YOUR_ORG/YOUR_REPO` with the GitHub repo where this package lives.

## Inputs
The CLI accepts the following flags (all optional if running on a `pull_request` event with `GITHUB_REPOSITORY` set):
- `--repo`: `owner/repo` (defaults to `GITHUB_REPOSITORY`)
- `--pr` or `--pr-number`: pull request number (auto-detected from event payload if available)

## How it works
- Uses GitHub REST API with `GITHUB_TOKEN` to read PR details and post a comment
- Uses Vercel AI SDK (`ai`, `@ai-sdk/openai`) to synthesize a witty image prompt and caption
- Uses OpenAI Images (`gpt-image-1`) to generate an image and embeds its URL in the comment
- Adds a hidden marker to detect if it has already commented, ensuring idempotency

## Environment Variables
- `GITHUB_TOKEN`: Provided automatically by GitHub Actions. Needed for GitHub API calls
- `OPENAI_API_KEY`: Your OpenAI API key. Add as a repository secret named `OPENAI_API_KEY`

## Local test
```bash
# Install deps
npm install

# Build
npm run build

# Run (example)
GITHUB_TOKEN=ghp_example OPENAI_API_KEY=sk-example \
node dist/index.js --repo your-org/your-repo --pr 123
```

## Notes
- Images are embedded using the URL returned by OpenAI and may be temporary
- No GitHub App is required; everything uses the standard `GITHUB_TOKEN`

## License
MIT
