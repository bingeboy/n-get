![Logo](https://raw.github.com/bingeboy/n-get/master/assets/nget-logo.png)

# n-get

A wget-like CLI tool for downloading files from the web using streams.

## Features

- 🚀 **Fast Downloads**: Uses modern Node.js streams and `node-fetch` for efficient file downloads
- 📁 **Parallel Downloads**: Download multiple files concurrently with configurable concurrency limit
- 🎯 **Custom Destination**: Specify where to save downloaded files
- ⏸️ **Resume Downloads**: Intelligent resumption of interrupted downloads with HTTP range requests
- 📊 **Real-time Progress**: Live progress tracking with download speed and ETA
- 📈 **Detailed Statistics**: Comprehensive download summaries with metrics
- ⚡ **Error Handling**: Graceful handling of network errors and invalid URLs
- 🔒 **Duplicate Handling**: Automatically handles duplicate filenames with timestamps
- 🤖 **AI Integration**: Intelligent configuration management with support for MCP servers, CrewAI, AutoGen, and LangChain
- 🌈 **Cross-platform**: Works beautifully on all operating systems

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

- `-d, --destination <path>`: Specify destination directory for downloads
- `-r, --resume`: Enable resume for interrupted downloads (default: true)
- `--no-resume`: Disable resume functionality
- `-l, --list-resume`: List resumable downloads in destination
- `-c, --max-concurrent <num>`: Maximum concurrent downloads (default: 3)
- `--ssh-key <path>`: Path to SSH private key file for SFTP authentication
- `--ssh-password <password>`: SSH password for SFTP authentication
- `--ssh-passphrase <passphrase>`: Passphrase for encrypted SSH private keys
- `-h, --help`: Show help information

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

