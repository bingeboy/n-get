# n-get CLI Tool: Pipe Support Analysis and Implementation Guide

The n-get CLI tool currently **lacks pipe support entirely** but has a well-designed architecture that would make adding this functionality straightforward. This analysis provides comprehensive guidance on implementing stdin/stdout pipe operations for the tool.

## Current pipe support status

**n-get does not support pipe operations.** The tool follows a traditional CLI pattern where URLs are provided as command-line arguments and files are saved directly to the filesystem. Specifically:

- **No stdin input support**: Cannot read URLs from piped input
- **No stdout output support**: Cannot stream downloaded content to stdout for chaining
- **No pipe chaining capability**: Cannot be used in Unix pipe chains like `curl | n-get | other-tool`

The current usage pattern is limited to: `nget <URLs> [options]` with files always downloaded to disk.

## Architecture analysis and feasibility

The n-get codebase has a **well-structured, modern architecture** that would facilitate adding pipe support:

### Core architectural components

**index.js** serves as the main CLI entry point, handling argument parsing and program coordination. **lib/recursivePipe.js** implements the core download logic using modern Node.js streams, with node-fetch replacing the deprecated request library. **lib/uriManager.js** manages URL validation and protocol handling, while **lib/chdir.js** handles directory operations and file system management.

The tool already uses **modern Node.js streams internally** for HTTP response processing, file writing, and progress tracking. These streams are memory-efficient and handle large files well, but they're not exposed for CLI pipe operations.

### Key integration points for pipe support

The modular design creates clear integration points where pipe support could be added:

**Input detection** would be implemented in index.js to detect when stdin is available versus URL arguments. **URL processing** in uriManager.js would be extended to handle URLs from stdin while maintaining existing validation. **Stream integration** in recursivePipe.js would be modified to accept URLs from readable streams and handle async URL processing.

## Implementation requirements

Adding pipe support would require **moderate complexity** implementation across several components:

### Reading URLs from stdin (pipe input)

The tool would need to detect when stdin is available and read URLs line-by-line, similar to wget's `-i -` pattern. This would involve:

- Modifying CLI argument parsing to detect stdin input
- Implementing readline interface for line-by-line URL processing
- Extending uriManager.js to handle streaming URL input
- Maintaining concurrent download capabilities for multiple piped URLs

### Outputting downloaded content to stdout (pipe output)

For stdout output, the tool would need to stream downloaded content directly to stdout instead of writing to files:

- Adding `-o -` or `--output=-` flag support
- Redirecting download streams to process.stdout
- Implementing quiet mode to suppress progress output
- Handling proper error propagation to stderr

### Architectural changes needed

**Minimal architectural changes** would be required due to the existing stream-based design:

- **CLI enhancement**: Extend argument parsing to handle `-i -` and `-o -` flags
- **Stream redirection**: Modify output destination from file streams to stdout
- **Progress adaptation**: Ensure progress information goes to stderr when using stdout
- **Error handling**: Implement proper EPIPE error handling for broken pipes

### Complexity assessment

The implementation would be **moderate complexity** requiring:
- **Basic level**: Simple pipe-through functionality (2-3 days)
- **Intermediate level**: Line processing with proper error handling (4-5 days)
- **Advanced level**: Full feature parity with progress, resume, and multi-URL support (1-2 weeks)

## Similar CLI tools comparison

Other download tools demonstrate established patterns that n-get should follow:

### wget pipe patterns

**wget** uses `-i -` for stdin input and `-O -` for stdout output:
```bash
echo "http://example.com" | wget -i -
wget -O - http://example.com | tar -xz
```

### curl pipe patterns

**curl** is more pipe-friendly by default, outputting to stdout naturally:
```bash
curl http://example.com | jq .
curl -s http://example.com/file.tar.gz | tar -xz
```

### Recommended n-get syntax

Following established conventions, n-get should implement:
```bash
# Input from stdin
echo "http://example.com/file.zip" | n-get -i -
cat urls.txt | n-get -i -

# Output to stdout
n-get -o - http://example.com/file.txt
n-get --output=- --quiet http://example.com/data.json

# Pipeline chaining
n-get -o - http://example.com/archive.tar.gz | tar -xz
```

## Best practices for Node.js CLI pipe support

Node.js provides robust patterns for implementing pipe support:

### Core implementation patterns

**Modern async/await approach** using `for await (const chunk of process.stdin)` provides clean line processing. **Proper error handling** for EPIPE errors is essential - broken pipes should exit gracefully with code 0. **Backpressure management** using `stream.pipeline()` ensures proper handling of large downloads.

### Essential libraries and techniques

**readline** interface enables line-by-line URL processing from stdin. **Transform streams** allow data processing without loading everything into memory. **process.stdin.isTTY** detection helps distinguish between interactive and pipe modes.

### Performance considerations

The streaming approach scales linearly with file size while maintaining constant memory usage (~10MB regardless of file size), making it essential for production CLI tools handling large datasets.

## Implementation recommendations

### Phase 1: Basic pipe support (1 week)

Implement core stdin URL reading and stdout content output:
- Add `-i -` flag for stdin URL input
- Add `-o -` flag for stdout content output
- Implement quiet mode (`-q`) to suppress progress when piping
- Basic error handling for pipe operations

### Phase 2: Enhanced features (1 week)

Add advanced pipe capabilities:
- Support for mixed input (both stdin and command-line URLs)
- Proper progress handling for piped scenarios
- Resume capability for piped downloads
- Comprehensive error handling and edge cases

### Phase 3: Production polish (3-5 days)

Ensure robust production readiness:
- Extensive testing with various pipe scenarios
- Performance optimization for large files
- Documentation and examples
- Backward compatibility verification

## Conclusion

n-get's modern Node.js architecture with existing stream infrastructure makes adding pipe support **highly feasible** with moderate implementation effort. The tool would benefit significantly from pipe support, bringing it in line with user expectations from wget and curl while maintaining its performance advantages and modern design. The implementation would require approximately **2-3 weeks** for full feature parity, making it a worthwhile enhancement that would significantly improve the tool's utility in Unix-style command pipelines.
