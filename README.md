![Logo](https://raw.github.com/bingeboy/n-get/master/assets/nget-logo.png)

# n-get

A modern, intelligent download manager with agent support and tooling + comprehensive tracking capabilities.

## Features

- 🚀 **Parallel Downloads**: Download multiple files concurrently with configurable concurrency limit
- 🤖 **Built for Agents**: Intelligent configuration management with support for MCP servers, CrewAI, AutoGen, and LangChain
- ⏸️ **Resume Downloads**: Intelligent resumption of interrupted downloads with HTTP range requests
- 📈 **Detailed Statistics**: Comprehensive download summaries with metrics

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Basic Usage](#usage)
- [Parallel Downloads](#parallel-downloads)
- [SSH/SFTP Support](#sshsftp-usage)
- [Configuration Management](#configuration-management)
- [Download History](#download-history)
- [AI Integration](#ai-integration)
- [Command Line Options](#command-line-options)
- [Resume Commands](#resume-commands)
- [API](#api)

## Requirements

- Node.js >= 18.0.0

## Installation

### Global Installation (Recommended)
```bash
npm install n-get -g
```

### From Source
```bash
git clone https://github.com/bingeboy/n-get
cd n-get
npm install
npm link  # For global access
```

## Usage

### Basic Usage

Download a single file:
```bash
nget https://example.com/file.zip
```

Download to a specific directory:
```bash
nget https://example.com/file.zip -d /path/to/destination
```

Download multiple files:
```bash
nget https://example.com/file1.zip https://example.com/file2.pdf -d ./downloads
```

### Examples

```bash
# Download a file (protocol optional)
nget example.com/file.zip

# Download multiple files to current directory
nget https://httpbin.org/json https://httpbin.org/uuid

# Download to specific directory
nget https://example.com/large-file.zip -d ~/Downloads

# Mix of protocols (auto-detection)
nget google.com/file.txt https://github.com/user/repo/archive/main.zip

# Resume interrupted downloads (default behavior)
nget https://example.com/large-file.zip
# If interrupted, run again to resume:
nget https://example.com/large-file.zip

# Resume from specific directory
nget resume -d ./downloads

# Disable resume functionality
nget --no-resume https://example.com/file.zip

# List resumable downloads
nget --list-resume -d ./downloads

# Resume specific download by number
nget resume 1

# Resume all downloads
nget resume all
```

### Parallel Downloads

n-get supports concurrent downloads for improved performance when downloading multiple files.

```bash
# Download multiple files with default concurrency (3)
nget https://example.com/file1.zip https://example.com/file2.pdf https://example.com/file3.jpg

# Use higher concurrency for faster downloads
nget https://site.com/file1.zip https://site.com/file2.zip --max-concurrent 5

# Conservative approach with lower concurrency
nget https://slow-server.com/file1.zip https://slow-server.com/file2.zip --max-concurrent 1
```

### SSH/SFTP Usage

n-get supports downloading files via SSH/SFTP with automatic authentication and resume capabilities.

#### Basic SFTP Downloads
```bash
# Download via SFTP (auto-detects SSH keys)
nget sftp://user@server.com/path/to/file.zip

# Download multiple files including SFTP
nget https://example.com/file1.pdf sftp://server.com/file2.zip -d ./downloads

# Download to specific directory
nget sftp://user@server.com/large-file.zip -d ~/Downloads
```

#### SSH Authentication Methods

**Auto-detection (Default):**
```bash
# Automatically scans ~/.ssh/ for keys (id_rsa, id_ed25519, id_ecdsa)
nget sftp://user@server.com/file.zip
```

**Private Key Authentication:**
```bash
# Specify custom SSH key
nget sftp://user@server.com/file.zip --ssh-key ~/.ssh/custom_key

# Encrypted private key with passphrase
nget sftp://user@server.com/file.zip --ssh-key ~/.ssh/encrypted_key --ssh-passphrase mypassword
```

**Password Authentication:**
```bash
# Password in URL (not recommended for security)
nget sftp://user:password@server.com/file.zip

# Password via command line
nget sftp://user@server.com/file.zip --ssh-password mypassword
```

#### SFTP Resume Support
```bash
# Resume interrupted SFTP downloads (default behavior)
nget sftp://user@server.com/large-file.zip
# If interrupted, run again to resume:
nget sftp://user@server.com/large-file.zip

# Resume SFTP downloads from specific directory
nget resume -d ./downloads
```

For more examples see project landing page or run `--help`.

## Configuration Management

N-Get includes a comprehensive configuration system added in v1.3.0, allowing you to manage settings, profiles, and preferences.

### Configuration Commands

```bash
# Show current configuration
nget config show

# Show specific configuration section
nget config show http

# Set configuration values
nget config set http.timeout 45000
nget config set downloads.maxConcurrent 5

# List available profiles
nget config profiles

# Switch to a configuration profile
nget config profile fast

# Validate your configuration
nget config validate

# Debug configuration issues
nget config debug
```

### Configuration Profiles

N-Get includes several pre-configured profiles for different use cases:

- **fast**: High-speed downloads with maximum concurrency
- **secure**: Security-focused with HTTPS-only and certificate validation  
- **bulk**: Optimized for large batch operations and bulk downloads
- **careful**: Conservative settings with detailed monitoring

## Download History

Track and analyze your download history with commands added in v1.4.0:

```bash
# Show recent download history
nget history show

# Show last 10 downloads
nget history show --limit 10

# Search downloads by URL or filename
nget history search "example.com"

# View download statistics
nget history stats

# Export history to CSV
nget history export --csv --output downloads.csv

# Clear all download history (requires confirmation)
nget history clear --confirm
```

### History Options

- `--limit <number>`: Maximum number of entries to display
- `--status <status>`: Filter by status (success, failed, in_progress)
- `--since <date>`: Show entries after specified date
- `--until <date>`: Show entries before specified date

## AI Integration

N-Get includes enterprise-grade AI integration capabilities for intelligent download automation and configuration management. The AI system enables dynamic optimization, profile management, and integration with popular AI frameworks.

### Quick Start with AI

```bash
# Enable AI features
nget --config-ai-enabled=true https://example.com/file.zip

# Use AI-optimized profiles
nget --config-ai-profile=fast https://example.com/urgent-file.zip
nget --config-ai-profile=secure https://example.com/sensitive-file.pdf
nget --config-ai-profile=bulk https://example.com/dataset1.zip https://example.com/dataset2.zip
```

### Supported AI Frameworks

- **MCP (Model Context Protocol)**: Full server implementation for Claude and other MCP-compatible AI assistants
- **CrewAI**: Multi-agent download optimization and task management
- **AutoGen**: Function-based integration for conversational AI workflows  
- **LangChain**: Tool integration for AI agent ecosystems

### Configuration Profiles

N-Get includes four AI-optimized profiles:

- **Fast**: High-speed downloads with maximum concurrency
- **Secure**: Security-focused with HTTPS-only and certificate validation
- **Bulk**: Optimized for large batch operations and bulk downloads
- **Careful**: Conservative settings with detailed monitoring and progress reporting

### Key AI Features

- **Agent Control**: AI agents have complete control over all configuration settings
- **Performance Monitoring**: Real-time metrics and status reporting for agent decision-making
- **Profile Selection**: Agents can choose and apply optimal profiles for different scenarios
- **Learning Data Collection**: Optional outcome tracking for agent training and improvement
- **Enterprise Integration**: Full audit logging and compliance features

For complete AI integration documentation, examples, and API reference, see:
**📖 [AI Integration Guide](docs/AI-INTEGRATION.md)**

## Command Line Options

### Download Options
- `-d, --destination <path>`: Specify destination directory for downloads
- `-r, --resume`: Enable resume for interrupted downloads (default: true)
- `--no-resume`: Disable resume functionality
- `-l, --list-resume`: List resumable downloads in destination
- `-c, --max-concurrent <num>`: Maximum concurrent downloads (default: 3)
- `--ssh-key <path>`: Path to SSH private key file for SFTP authentication
- `--ssh-password <password>`: SSH password for SFTP authentication
- `--ssh-passphrase <passphrase>`: Passphrase for encrypted SSH private keys
- `-h, --help`: Show help information

### Configuration Commands
- `nget config show [section]`: Show current configuration
- `nget config set <key> <value>`: Set configuration value
- `nget config profiles`: List available configuration profiles
- `nget config profile <name>`: Switch to configuration profile
- `nget config validate`: Validate current configuration
- `nget config debug`: Show configuration debug information

### History Commands
- `nget history show`: Show recent download history
- `nget history search <term>`: Search downloads by URL or filename
- `nget history stats`: Show download statistics
- `nget history export`: Export history data
- `nget history clear --confirm`: Clear all download history

## Resume Commands

- `nget resume -d <path>`: Resume from specific directory
- `nget resume <number>`: Resume a specific numbered download from the list
- `nget resume all`: Resume all downloads from the list
- `nget --list-resume`: List all resumable downloads

## API

The core functionality is also available as a module:

```javascript
const download = require('n-get/lib/downloadPipeline');

// Download files programmatically
download(['https://example.com/file.zip'], './downloads')
    .then(results => {
        console.log('Download results:', results);
    })
    .catch(error => {
        console.error('Download failed:', error);
    });
```

## License

MIT

