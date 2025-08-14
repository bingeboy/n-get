![Logo](https://raw.github.com/bingeboy/n-get/master/assets/nget-logo.png)

# n-get

A modern, intelligent download manager with agent support and tooling + comprehensive tracking capabilities.

## Features

- 🚀 **Parallel Downloads**: Download multiple files concurrently with configurable concurrency limit
- 🤖 **Built for Agents**: Intelligent configuration management with support for MCP servers, CrewAI, AutoGen, and LangChain
- ⏸️ **Resume Downloads**: Intelligent resumption of interrupted downloads with HTTP range requests
- 📊 **Fetch Mode**: Output HTTP response content to stdout for curl/fetch-like behavior
- 📈 **Detailed Statistics**: Comprehensive download summaries with metrics

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Basic Usage](#usage)
- [Fetch Mode (Stdout)](#fetch-mode-stdout)
- [Parallel Downloads](#parallel-downloads)
- [SSH/SFTP Support](#sshsftp-usage)
- [Configuration Management](#configuration-management)
- [Download History](#download-history)
- [AI Integration](#ai-integration)
- [Command Line Options](#command-line-options)
- [Resume Commands](#resume-commands)
- [Environment Variables](#environment-variables)
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

## Fetch Mode (Stdout)

N-Get includes a powerful **fetch mode** that outputs HTTP response content directly to stdout, making it work like `curl` or browser `fetch()` for command-line usage and AI agents.

### Basic Fetch Mode

```bash
# Output JSON response to stdout
nget --stdout https://api.example.com/data.json

# Pipe to other tools for processing
nget --stdout https://httpbin.org/ip | jq .

# Use in shell scripts
API_RESPONSE=$(nget --stdout https://api.example.com/status)
echo "API Status: $API_RESPONSE"
```

### Configuration-Based Fetch Mode

Enable fetch mode through configuration for consistent behavior:

```bash
# Environment variable
export NGET_DOWNLOADS_ENABLESTDOUT=true
nget https://api.example.com/data.json

# Configuration profile
nget config profile fetch
nget https://api.example.com/users
```

### Fetch Mode Features

- **Single URL Only**: Fetch mode works with one URL at a time to avoid mixing response content
- **No Progress Bars**: Clean stdout output without progress indicators
- **No Resume**: Downloads go directly to stdout, resume functionality is disabled
- **Agent Friendly**: Perfect for AI agents and automation scripts
- **Error Handling**: Errors go to stderr, keeping stdout clean

### Fetch Mode Restrictions

```bash
# ❌ These combinations are not allowed with --stdout:
nget --stdout url1 url2        # Multiple URLs
nget --stdout -o file.txt url  # File output conflict
nget --stdout --recursive url  # Recursive downloads

# ✅ These work perfectly:
nget --stdout https://api.example.com/data.json
nget --stdout https://raw.githubusercontent.com/user/repo/main/config.yaml
```

### AI Agent Integration

Fetch mode is optimized for AI agents and automation:

```bash
# Use with predefined fetch profile
nget --config-ai-profile=fetch https://api.example.com/endpoint

# Environment-based configuration for agents
export NGET_DOWNLOADS_ENABLESTDOUT=true
nget https://api.service.com/data
```

The fetch profile automatically configures:
- `enableStdout: true` - Enable fetch mode
- `maxConcurrent: 1` - Single request processing
- `progressReporting: false` - No visual progress
- `enableResume: false` - Direct streaming to stdout

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

> **Environment Variables**: All configuration values can be set via `NGET_*` environment variables. See [Environment Variables](#environment-variables) section for details.

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

## Logging and Output Formats

N-Get provides structured logging with multiple output formats for different use cases. This is especially useful for AI agents, monitoring systems, and data analysis.

### Logging Format Commands

```bash
# Show current logging format
nget logs format

# Set JSON structured logging (ideal for AI agents and log analysis)
nget logs format --json

# Set CSV format for spreadsheet analysis
nget logs format --csv

# Set human-readable text format (default)
nget logs format --text
```

> **Environment Variables**: Logging format can be controlled via `NGET_LOG_FORMAT` and `NGET_LOG_LEVEL` environment variables.

### Output Format Examples

**Text Format (Default):**
```
[2024-01-15T10:30:25.123Z] INFO: Download started {"url":"https://example.com/file.zip","size":1048576}
[2024-01-15T10:30:26.456Z] INFO: Download completed {"duration":1333,"speed":"786KB/s","status":"success"}
[2024-01-15T10:30:26.457Z] WARN: File already exists, renamed to file_1.zip {"originalName":"file.zip"}
```

**JSON Format (Machine-Readable):**
```json
{"timestamp":"2024-01-15T10:30:25.123Z","level":"INFO","message":"Download started","meta":{"url":"https://example.com/file.zip","size":1048576},"process":{"pid":12345,"uptime":45.2}}
{"timestamp":"2024-01-15T10:30:26.456Z","level":"INFO","message":"Download completed","meta":{"duration":1333,"speed":"786KB/s","status":"success"},"correlationId":"req_123"}
{"timestamp":"2024-01-15T10:30:26.457Z","level":"WARN","message":"File already exists, renamed to file_1.zip","meta":{"originalName":"file.zip","newName":"file_1.zip"}}
```

**CSV Format (Spreadsheet-Ready):**
```csv
timestamp,level,message,url,size,duration,speed,status,error
2024-01-15T10:30:25.123Z,INFO,Download started,https://example.com/file.zip,1048576,,,started,
2024-01-15T10:30:26.456Z,INFO,Download completed,https://example.com/file.zip,1048576,1333,786KB/s,success,
2024-01-15T10:30:26.457Z,WARN,File already exists renamed,https://example.com/file.zip,1048576,,,warning,duplicate_file
```

### Using Logging Formats with Downloads

```bash
# Download with JSON logging for AI processing
nget logs format --json
nget https://example.com/large-file.zip -d ./downloads

# Download with CSV logging for analysis
nget logs format --csv  
nget https://site1.com/data.zip https://site2.com/backup.tar.gz

# Batch downloads with structured logging
nget logs format --json
nget https://example.com/file1.zip https://example.com/file2.pdf --max-concurrent 5
```

### Programmatic Usage

When embedding n-get as a module, you can configure logging programmatically:

```javascript
const Logger = require('n-get/lib/services/Logger');

// Create logger with JSON format for AI processing
const logger = new Logger({
    format: 'json',
    level: 'info',
    outputs: ['console', 'file']
});

// Create logger with CSV format for data analysis
const csvLogger = new Logger({
    format: 'text', // Use text format but process as CSV
    level: 'debug',
    outputs: ['console', 'file'],
    logDir: './analysis-logs'
});

// Use with download operations
const download = require('n-get/lib/downloadPipeline');

download(['https://example.com/file.zip'], './downloads', {
    logger: logger,
    onProgress: (progress) => {
        logger.info('Download progress', {
            percentage: progress.percentage,
            speed: progress.speed,
            eta: progress.eta
        });
    }
})
.then(results => {
    logger.info('Batch download completed', {
        totalFiles: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
    });
})
.catch(error => {
    logger.error('Download failed', { 
        error: error.message,
        code: error.code 
    }, error);
});
```

### Environment Variable Configuration

You can also control logging format via environment variables:

```bash
# Set format via environment variable
export NGET_LOG_FORMAT=json
nget https://example.com/file.zip

# Set log level and format
export NGET_LOG_LEVEL=debug
export NGET_LOG_FORMAT=csv
nget https://example.com/batch-files/*.zip
```

### Use Cases by Format

- **Text Format**: Human-readable console output, debugging, development
- **JSON Format**: AI agent processing, log aggregation systems, structured analysis
- **CSV Format**: Spreadsheet import, data analysis, reporting dashboards

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

> **Environment Variables**: Many download settings can be controlled via environment variables like `NGET_DOWNLOADS_MAXCONCURRENT`, `NGET_DOWNLOADS_ENABLERESUME`. See [Environment Variables](#environment-variables).

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

## Environment Variables

N-Get supports extensive configuration through environment variables using the `NGET_*` prefix. Environment variables follow the pattern `NGET_SECTION_KEY=value` and override configuration file settings.

### Core Configuration Variables

#### HTTP/Network Settings
- `NGET_HTTP_TIMEOUT=30000` - Request timeout in milliseconds
- `NGET_HTTP_MAXRETRIES=3` - Maximum retry attempts
- `NGET_HTTP_MAXCONNECTIONS=20` - Maximum concurrent connections
- `NGET_HTTP_USERAGENT="N-Get-Enterprise/2.0"` - Custom user agent
- `NGET_HTTP_KEEPALIVE_ENABLED=true` - Enable HTTP keep-alive
- `NGET_HTTP_IPV6_ENABLED=true` - Enable IPv6 support
- `NGET_HTTP_IPV6_PREFERIPV6=false` - Prefer IPv6 over IPv4

#### Download Behavior
- `NGET_DOWNLOADS_MAXCONCURRENT=3` - Maximum concurrent downloads
- `NGET_DOWNLOADS_ENABLERESUME=true` - Enable download resumption
- `NGET_DOWNLOADS_PROGRESSREPORTING=true` - Show progress bars
- `NGET_DOWNLOADS_CHUNKUPDATEFREQUENCY=1000` - Progress update interval (ms)
- `NGET_DOWNLOADS_CHUNKSIZE=50` - Chunk size for progress updates
- `NGET_DOWNLOADS_ENABLESTDOUT=false` - Enable stdout mode for fetch-like behavior

#### Security Settings
- `NGET_SECURITY_MAXFILESIZE=10737418240` - Max file size in bytes (10GB)
- `NGET_SECURITY_ALLOWEDPROTOCOLS="https,http,sftp"` - Allowed protocols (comma-separated)
- `NGET_SECURITY_BLOCKPRIVATENETWORKS=false` - Block private network access
- `NGET_SECURITY_BLOCKLOCALHOST=false` - Block localhost access
- `NGET_SECURITY_CERTIFICATEVALIDATION=true` - Validate SSL certificates
- `NGET_SECURITY_SANITIZEFILENAMES=true` - Sanitize downloaded filenames

#### Logging Configuration
- `NGET_LOG_LEVEL=info` - Log level (trace, debug, info, warn, error)
- `NGET_LOG_FORMAT=json` - Output format (json, csv, text)
- `NGET_LOG_ENABLECOLORS=true` - Enable colored console output

#### SSH/SFTP Settings  
- `NGET_SSH_TIMEOUT=30000` - SSH connection timeout in milliseconds

#### AI Integration
- `NGET_AI_ENABLED=false` - Enable AI agent features
- `NGET_AI_MCP_ENABLED=false` - Enable MCP server
- `NGET_AI_MCP_PORT=8080` - MCP server port
- `NGET_AI_PROFILES_ENABLED=true` - Enable configuration profiles

#### Monitoring
- `NGET_MONITORING_ENABLED=true` - Enable monitoring and metrics
- `NGET_MONITORING_METRICSPORT=9090` - Port for metrics endpoint
- `NGET_MONITORING_HEALTHCHECKPORT=8080` - Port for health checks

### Usage Examples

#### Basic Environment Setup
```bash
# Set basic download configuration
export NGET_DOWNLOADS_MAXCONCURRENT=5
export NGET_HTTP_TIMEOUT=45000
export NGET_LOG_LEVEL=debug

# Download with environment settings
nget https://example.com/file.zip
```

#### High-Performance Configuration
```bash
# Optimize for speed
export NGET_HTTP_MAXCONNECTIONS=50
export NGET_DOWNLOADS_MAXCONCURRENT=10
export NGET_HTTP_IPV6_PREFERIPV6=true
export NGET_LOG_LEVEL=warn

nget https://cdn.example.com/large-files/*.zip
```

#### Security-Focused Setup
```bash
# Maximum security settings
export NGET_SECURITY_ALLOWEDPROTOCOLS="https,sftp"
export NGET_SECURITY_BLOCKPRIVATENETWORKS=true
export NGET_SECURITY_BLOCKLOCALHOST=true
export NGET_SECURITY_CERTIFICATEVALIDATION=true
export NGET_LOG_LEVEL=info

nget https://secure.example.com/sensitive-data.zip
```

#### AI Agent Integration
```bash
# Enable AI features with structured logging
export NGET_AI_ENABLED=true
export NGET_AI_MCP_ENABLED=true
export NGET_AI_MCP_PORT=8080
export NGET_LOG_FORMAT=json
export NGET_LOG_LEVEL=info

nget https://example.com/dataset.zip
```

#### Development Configuration
```bash
# Full debugging and monitoring setup
export NGET_LOG_LEVEL=trace
export NGET_LOG_FORMAT=json
export NGET_LOG_ENABLECOLORS=true
export NGET_MONITORING_ENABLED=true
export NGET_DOWNLOADS_PROGRESSREPORTING=true
export NGET_HTTP_MAXRETRIES=5
export NODE_ENV=development

nget https://test.example.com/debug-files/*.zip --max-concurrent 2
```

### Complete Environment Setup Example

```bash
#!/bin/bash
# N-Get Enterprise Configuration Script

# Network & Performance
export NGET_HTTP_TIMEOUT=60000
export NGET_HTTP_MAXRETRIES=5
export NGET_HTTP_MAXCONNECTIONS=30
export NGET_HTTP_KEEPALIVE_ENABLED=true
export NGET_HTTP_IPV6_ENABLED=true

# Download Settings
export NGET_DOWNLOADS_MAXCONCURRENT=7
export NGET_DOWNLOADS_ENABLERESUME=true
export NGET_DOWNLOADS_PROGRESSREPORTING=true

# Security Configuration
export NGET_SECURITY_ALLOWEDPROTOCOLS="https,sftp"
export NGET_SECURITY_CERTIFICATEVALIDATION=true
export NGET_SECURITY_SANITIZEFILENAMES=true

# Logging Setup
export NGET_LOG_LEVEL=info
export NGET_LOG_FORMAT=json
export NGET_LOG_ENABLECOLORS=true

# AI Integration
export NGET_AI_ENABLED=true
export NGET_AI_PROFILES_ENABLED=true

# Monitoring
export NGET_MONITORING_ENABLED=true
export NGET_MONITORING_METRICSPORT=9090

echo "N-Get environment configured!"
echo "Current settings:"
env | grep NGET_ | sort
```

### Environment Variable Priority

Configuration is loaded in the following order (later overrides earlier):
1. **Default configuration** (config/default.yaml)
2. **Environment-specific config** (config/development.yaml, config/production.yaml)
3. **Local configuration** (config/local.yaml)
4. **Environment variables** (NGET_*)
5. **Command-line arguments**

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

