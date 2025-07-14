![Logo](https://raw.github.com/bingeboy/n-get/master/assets/nget-logo.png)

# n-get

A wget-like CLI tool for downloading files from the web using streams.

## Features

- 🚀 **Fast Downloads**: Uses modern Node.js streams and `node-fetch` for efficient file downloads
- 📁 **Multiple Files**: Download multiple files concurrently with a single command
- 🎯 **Custom Destination**: Specify where to save downloaded files
- 🔄 **Auto Protocol**: Automatically adds `http://` if no protocol is specified
- ⏸️ **Resume Downloads**: Intelligent resumption of interrupted downloads with HTTP range requests
- 📊 **Real-time Progress**: Live progress tracking with download speed and ETA
- 🎭 **Smart File Icons**: Automatic emoji selection based on file type
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

# Disable resume functionality
nget --no-resume https://example.com/file.zip

# List resumable downloads
nget --list-resumable -d ./downloads
```

Fore more examples see project landing page or run `--help`.

## Command Line Options

- `-d, --destination <path>`: Specify destination directory for downloads
- `-r, --resume`: Enable resume for interrupted downloads (default: true)
- `--no-resume`: Disable resume functionality
- `-l, --list-resumable`: List resumable downloads in destination
- `-h, --help`: Show help information

## API

The core functionality is also available as a module:

```javascript
const recursivePipe = require('n-get/lib/recursivePipe');

// Download files programmatically
recursivePipe(['https://example.com/file.zip'], './downloads')
    .then(results => {
        console.log('Download results:', results);
    })
    .catch(error => {
        console.error('Download failed:', error);
    });
```

## License

MIT

