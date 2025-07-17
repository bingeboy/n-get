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

Fore more examples see project landing page or run `--help`.

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
const download = require('n-get/lib/recursivePipe');

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

