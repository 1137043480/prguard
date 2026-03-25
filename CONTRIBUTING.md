# Contributing to PRGuard

Thank you for your interest in contributing to PRGuard! 🛡️

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/prguard.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feat/your-feature`

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Pull Request Guidelines

- Use conventional commit messages (`feat:`, `fix:`, `docs:`, etc.)
- Include a clear description of what your PR does and why
- Add tests for new features
- Make sure all existing tests pass

## Adding New Checks

1. Create a new file in `src/checks/` following the existing pattern
2. Export a function that takes `(pr: PRData, config: Config)` and returns `CheckResult[]`
3. Import and call your check function in `src/index.ts`
4. Add corresponding configuration options to `action.yml` and `src/config/schema.ts`
5. Add tests

## Reporting Issues

- Use the [issue tracker](https://github.com/1137043480/prguard/issues)
- Include steps to reproduce
- Include the PRGuard version and configuration

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
