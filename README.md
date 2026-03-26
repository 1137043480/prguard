# 🛡️ PRGuard

**AI-powered PR quality guardian — detect and block low-quality & AI slop pull requests**

[![GitHub Action](https://img.shields.io/badge/GitHub-Action-blue?logo=github)](https://github.com/1137043480/prguard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![中文文档](https://img.shields.io/badge/🌐-中文文档-red)](./README_CN.md)

---

> Open-source maintainers are drowning in AI-generated slop PRs. PRGuard stops them before they reach your review queue — with **zero cost** in rules mode, or deep AI analysis with your own API key.

## ✨ Features

| Feature | Rules Mode (Free) | AI Mode (BYOK) |
|---------|:-:|:-:|
| 40+ quality checks | ✅ | ✅ |
| AI slop pattern detection | ✅ | ✅ |
| Quality scoring (0-100) | ✅ | ✅ |
| **Import verification against source** | ✅ | ✅ |
| **Code style mismatch detection** | ✅ | ✅ |
| **PR history / reputation analysis** | ✅ | ✅ |
| **Cross-repo spam detection** | ✅ | ✅ |
| Semantic code analysis | ❌ | ✅ |
| Hallucinated API detection | Basic | Deep |
| Auto-close slop PRs | ✅ | ✅ |

### What PRGuard Checks

- **🏷️ Title** — Conventional commit format, length, blocked patterns
- **📝 Description** — Completeness, template compliance, AI filler phrase detection
- **📦 Commits** — Message quality, author matching, lazy message detection
- **🌿 Branch** — Source/target branch rules, naming convention
- **📁 Files** — Change size limits, sensitive files, excessive comments detection
- **👤 Contributor** — Account age, spam username detection, trust scoring
- **🤖 AI Slop** — Emoji overload, hallucinated imports, over-engineering signals

**V2 Advanced (unique to PRGuard):**
- **📦 Import Verification** — Checks imports against actual project source code (not guessing)
- **🎨 Code Style** — Detects naming convention and indent style mismatches vs project
- **📜 PR History** — Analyzes author's merge/rejection rate, flags serial rejected contributors
- **🕸️ Cross-Repo Spam** — Detects users opening PRs across 10+ repos in 24h (bot detection)

### 📸 Example Output

When PRGuard detects a low-quality PR, it posts a detailed review comment:

```
❌ PRGuard Review — Failed

Quality Score: 57/100 🟡 Fair

⚠️ 4 issue(s) found:

🟡 Warnings (4)
- PR title does not follow conventional format. Got: "Update some files"
- PR description has too many emoji (13, max 10)
- AI slop patterns detected: "this pr aims to", "best practices",
  "comprehensive solution", "seamless integration"
- 1 commit(s) have lazy/meaningless messages: "update"

🤖 AI Analysis
This PR appears to be AI-generated filler with placeholder logic,
suspicious imports, and excessive comment noise.

Slop Indicators:
- Hallucinated imports: some_nonexistent_package
- Excessive comments restating obvious code behavior
- Generic naming (do_stuff, another_function)
- Boilerplate with no real implementation
```

## 🚀 Quick Start

### Rules Only (Zero Cost, Zero Config)

```yaml
name: PR Quality
on:
  pull_request_target:
    types: [opened, reopened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  prguard:
    runs-on: ubuntu-latest
    steps:
      - uses: 1137043480/prguard@v0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Rules + AI Analysis (BYOK — Bring Your Own Key)

PRGuard supports **any OpenAI-compatible API**, Anthropic Claude, and self-hosted Ollama.

> **You only need your own API key. PRGuard does NOT include any built-in AI.** Your key is stored in your repository's [GitHub Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets) and is never exposed in logs or code.

#### OpenAI

```yaml
      - uses: 1137043480/prguard@v0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          mode: 'ai'
          ai-provider: 'openai'
          ai-api-key: ${{ secrets.OPENAI_API_KEY }}
          ai-model: 'gpt-4o-mini'  # or gpt-4o, gpt-4-turbo, etc.
```

#### Any OpenAI-Compatible API ✅

Any provider with an OpenAI-compatible `/v1/chat/completions` endpoint works out of the box:

| Provider | `ai-base-url` | Example Model |
|----------|---------------|---------------|
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| **Together AI** | `https://api.together.xyz/v1` | `meta-llama/Llama-3-70b-chat-hf` |
| **Mistral** | `https://api.mistral.ai/v1` | `mistral-large-latest` |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4-20250514` |
| **Azure OpenAI** | `https://{name}.openai.azure.com/openai/deployments/{model}/v1` | your deployment |
| **NewAPI / One API** | `https://your-server.com/v1` | any model |

```yaml
      - uses: 1137043480/prguard@v0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          mode: 'ai'
          ai-provider: 'openai'
          ai-api-key: ${{ secrets.AI_API_KEY }}
          ai-base-url: ${{ secrets.AI_BASE_URL }}  # Your custom endpoint
          ai-model: 'deepseek-chat'  # Your model name
```

#### Anthropic Claude

```yaml
      - uses: 1137043480/prguard@v0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          mode: 'ai'
          ai-provider: 'anthropic'
          ai-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          ai-model: 'claude-sonnet-4-20250514'
```

#### Self-hosted Ollama (Free, Private)

```yaml
      - uses: 1137043480/prguard@v0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          mode: 'ai'
          ai-provider: 'ollama'
          ai-base-url: 'http://your-server:11434/v1'
          ai-model: 'llama3'
          # No API key needed for Ollama
```

> **TL;DR:** Set `ai-provider: 'openai'` + `ai-base-url` to point to **any** OpenAI-compatible endpoint. This works with 99% of AI providers.

## ⚙️ Configuration

### Scoring

| Input | Default | Description |
|-------|---------|-------------|
| `max-failures` | `4` | Max check failures before action is taken |
| `min-quality-score` | `40` | Minimum score (0-100) to pass |

### PR Title

| Input | Default | Description |
|-------|---------|-------------|
| `require-conventional-title` | `true` | Require conventional commit style |
| `blocked-title-patterns` | `Update README.md,...` | Blocked title patterns (regex) |

### PR Description

| Input | Default | Description |
|-------|---------|-------------|
| `require-description` | `true` | Require PR description |
| `min-description-length` | `30` | Minimum description length |
| `max-description-length` | `5000` | Max length (slop signal) |
| `max-emoji-count` | `10` | Max emoji in description |

### Commits

| Input | Default | Description |
|-------|---------|-------------|
| `require-conventional-commits` | `false` | Require conventional commits |
| `require-commit-author-match` | `true` | Commit author must match PR author |

### Files

| Input | Default | Description |
|-------|---------|-------------|
| `max-files-changed` | `50` | Max files changed |
| `max-additions` | `2000` | Max lines added |
| `detect-excessive-comments` | `true` | Detect AI-typical comment patterns |
| `detect-hallucinated-imports` | `true` | Detect non-existent packages |

### Contributor

| Input | Default | Description |
|-------|---------|-------------|
| `min-account-age-days` | `7` | Minimum account age |
| `detect-spam-usernames` | `true` | Detect random/bot usernames |

### Actions

| Input | Default | Description |
|-------|---------|-------------|
| `close-pr` | `false` | Auto-close failing PRs |
| `add-label` | `needs-review` | Label to add on failure |
| `comment-on-pr` | `true` | Post review comment |

### Exemptions

| Input | Default | Description |
|-------|---------|-------------|
| `exempt-bots` | `true` | Exempt bot accounts |
| `exempt-draft-prs` | `true` | Exempt draft PRs |
| `exempt-users` | `` | Comma-separated exempt users |
| `exempt-labels` | `` | Exempt PR labels |

> **Note:** Owners, Members, and Collaborators are **automatically exempt** — no configuration needed.

## 📊 Outputs

| Output | Description |
|--------|-------------|
| `quality-score` | Overall quality score (0-100) |
| `passed` | Whether the PR passed |
| `failures` | Number of failed checks |
| `report` | Full JSON report |

## 🆚 PRGuard vs Alternatives

| Feature | PRGuard | anti-slop | PR-Agent | CodeRabbit |
|---------|---------|-----------|----------|------------|
| Rule checks | 30+ | 31 | ❌ | ❌ |
| AI semantic analysis | ✅ (BYOK) | ❌ | ✅ | ✅ |
| AI slop detection | ✅ Deep | ✅ Basic | ❌ | ❌ |
| Quality scoring | ✅ 0-100 | ❌ | ❌ | ❌ |
| Self-hosted AI (Ollama) | ✅ | ❌ | ❌ | ❌ |
| Zero-cost mode | ✅ | ✅ | ❌ | ❌ |
| License | MIT | MIT | Apache | Closed |

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## 📄 License

MIT © [1137043480](https://github.com/1137043480)
