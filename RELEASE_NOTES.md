# Release Notes - v1.6.0

## Overview
This release migrates the codebase to TypeScript, introduces a machine-readable NDJSON event stream as the default output mode, and adds several agent-focused features including isolated download sessions, a worker-thread checksum pool, and multi-process job visibility.

## 🚀 New Features
- **TypeScript Migration**: Full codebase migrated from JavaScript to TypeScript. `tsc` outputs `.js` alongside `.ts` in-place — no separate `dist/` directory. Migrated files include `DownloadError`, `ipv6Utils`, `Logger`, `HistoryManager`, `SecurityService`, `ConfigManager`, `downloadPipeline`, `index`, plus new TypeScript files for workers and CLI.
- **DownloadSession**: New `lib/core/DownloadSession.ts` replaces module-level globals in the download pipeline. Each CLI invocation gets an isolated session owning its own `Logger`, `SecurityService`, and `MetadataService` instances, eliminating cross-call state contamination.
- **NDJSON Event Stream**: `lib/core/NgetEmitter.ts` emits structured newline-delimited JSON to stdout by default, covering the full download lifecycle. Agents can parse output directly without screen-scraping.
- **Human Mode**: `--human` flag (or automatic TTY detection) enables progress bars and banners. Without it, output is machine-readable NDJSON. Pipe mode (`-o -`) always sends events to stderr.
- **`nget jobs` Command**: New subcommand lists all active download sessions across processes. Reads `~/.nget/active/*.json` and prunes dead PIDs automatically — useful for multi-agent visibility.
- **ChecksumPool**: `lib/workers/ChecksumPool.ts` + `ChecksumWorker.ts` implement a worker-thread pool for CPU-bound hash computation (MD5/SHA256), keeping the event loop free during checksum calculation on large files.
- **`--agent-id` Flag**: Lets the calling agent identify itself in session metadata and active session files.
- **Shared Types**: `types/index.ts` is the single source of truth for all TypeScript interfaces across the codebase.

## 🔧 Developer Experience
- **TypeScript**: Full type safety across the codebase with strict compilation
- **Worker Threads**: Offload CPU-bound checksum work to a managed thread pool
- **Isolated Sessions**: No shared mutable state between concurrent CLI invocations

## 💔 Breaking Changes
- Default output is now NDJSON (machine-readable). Pass `--human` or run in a TTY to restore progress bars and banners.

---

**Full Changelog**: [Compare v1.5.x...v1.6.0](https://github.com/bingeboy/n-get/compare/v1.5.1...v1.6.0)

---

# Release Notes - v1.3.0

## Overview
This release focuses on improving code quality, performance, and maintainability while removing legacy code and hardcoded values.

## 🚀 New Features
- **AI Integration**: Added experimental AI integration capabilities for enhanced functionality
- **Configuration Management**: Implemented proper configuration management system replacing hardcoded values

## 🐛 Bug Fixes
- Updated and fixed test suite for better reliability
- Improved error handling across the application
- Enhanced security measures and logging capabilities

## ⚡ Performance Improvements
- Significant performance optimizations implemented
- Code cleanup and removal of legacy "vibe coding" patterns

## 🔧 Developer Experience
- **Linting**: Added comprehensive linting rules and JSDoc documentation
- **Testing**: Updated test suite with improved coverage and reliability
- **Configuration**: Added proper configuration management with YAML support
- **Documentation**: Enhanced documentation with AI integration guides

## 📦 Dependencies
- Updated to require Node.js >= 18.0.0
- Added new dependencies:
  - `joi` for configuration validation
  - `js-yaml` for YAML configuration support
  - `cli-progress` for better progress indication
- Updated existing dependencies for security and performance

## 🗂️ Files Changed
- Configuration system overhaul (`config/` directory)
- Core application logic improvements (`index.js`, `lib/` directory)
- Enhanced testing framework
- Updated documentation

## 💔 Breaking Changes
- Minimum Node.js version bumped to 18.0.0
- Removed hardcoded configuration values (migration to YAML config required)

## 🙏 Contributors
Thanks to all contributors who helped make this release possible!

---

**Full Changelog**: [Compare v1.2.x...v1.3.0](https://github.com/bingeboy/n-get/compare/v1.2.0...v1.3.0)