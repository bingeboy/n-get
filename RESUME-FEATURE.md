# ⏸️ Resume Interrupted Downloads Feature

n-get now supports intelligent resume functionality for interrupted downloads! This powerful feature automatically detects partial downloads and resumes them from where they left off.

## 🚀 Key Features

### ✅ **Automatic Resume Detection**
- Detects partially downloaded files automatically
- Validates file integrity before resuming
- Supports HTTP range requests (RFC 7233)
- Smart duplicate file handling

### 🔍 **Server Compatibility Validation**
- Tests server support for range requests (`Accept-Ranges: bytes`)
- Validates ETag and Last-Modified headers
- Graceful fallback for non-resumable servers

### 📊 **Intelligent Progress Tracking**
- Continues progress from resume point
- Shows resumption status in UI
- Tracks both resumed and new downloads
- Real-time speed calculation

## 📋 How It Works

### 1. **Metadata Storage**
When downloading files, n-get creates metadata files in `.nget-resume/` directory containing:
```json
{
  "url": "https://example.com/file.zip",
  "filePath": "/downloads/file.zip",
  "totalSize": 1048576,
  "createdAt": "2025-01-01T12:00:00.000Z",
  "lastModified": "Wed, 01 Jan 2025 12:00:00 GMT",
  "etag": "\"abc123\"",
  "contentLength": "1048576"
}
```

### 2. **Resume Process**
1. **Check for partial file**: Verify if file exists and is incomplete
2. **Validate server headers**: Compare ETag/Last-Modified to detect changes
3. **Test range support**: Ensure server supports HTTP range requests
4. **Create range request**: Request bytes from resume position
5. **Append to file**: Continue writing from where it left off

### 3. **Safety Validations**
- ✅ File integrity validation with server headers
- ✅ Size boundary checks
- ✅ Server capability verification
- ✅ Corrupted metadata detection

## 🎮 Usage Examples

### **Basic Resume (Default)**
```bash
# Resume is enabled by default
nget https://example.com/large-file.zip

# If download is interrupted, run the same command again
nget https://example.com/large-file.zip
# ▶️ Resuming large-file.zip from 15.2 MB (67.3%)
```

### **Explicit Resume Control**
```bash
# Explicitly enable resume
nget --resume https://example.com/file.zip

# Disable resume functionality
nget --no-resume https://example.com/file.zip
```

### **List Resumable Downloads**
```bash
# Show all resumable downloads in current directory
nget --list-resumable

# Show resumable downloads in specific directory
nget --list-resumable -d ./downloads
```

### **Output Example:**
```
📋 Found 2 resumable download(s):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 📦 large-archive.zip
   📏 15.2 MB/23.1 MB (65.8% complete)
   🌐 https://example.com/large-archive.zip
2. 📄 document.pdf
   📏 892.1 KB/1.2 MB (74.3% complete)
   🌐 https://example.com/document.pdf
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 🔧 Technical Implementation

### **HTTP Range Requests**
```javascript
// Example range request headers
{
  'Range': 'bytes=1048576-',
  'User-Agent': 'n-get-resume/1.0',
  'Connection': 'keep-alive'
}

// Server response validation
HTTP/1.1 206 Partial Content
Content-Range: bytes 1048576-2097151/2097152
Content-Length: 1048576
```

### **Resume Validation Flow**
```
1. Check if partial file exists
   ├─ No: Start new download
   └─ Yes: Continue to validation

2. Load metadata from .nget-resume/
   ├─ Not found: Start new download
   └─ Found: Continue to server validation

3. Test server range support
   ├─ Not supported: Start new download with new filename
   └─ Supported: Continue to integrity check

4. Validate file integrity
   ├─ ETag/Last-Modified changed: Start new download
   ├─ File size invalid: Start new download
   └─ Valid: Resume download

5. Resume from byte position
```

### **File Organization**
```
downloads/
├── file1.zip                    # Downloaded file
├── file2.pdf                    # Downloaded file
└── .nget-resume/                # Metadata directory
    ├── abc123.nget-meta          # Metadata for file1.zip
    └── def456.nget-meta          # Metadata for file2.pdf
```

## 🎯 Smart Features

### **Automatic Cleanup**
- ✅ Metadata removed after successful download
- ✅ Old metadata files cleaned up (7+ days)
- ✅ Orphaned metadata detection and removal

### **Error Handling**
- 🔄 Graceful fallback to new download if resume fails
- 🚫 Skip resume for files that changed on server
- ⚠️ Clear error messages for resume failures

### **Performance Optimizations**
- ⚡ Efficient progress tracking with throttling
- 💾 Minimal metadata storage overhead
- 🔀 Non-blocking resume validation

## 📊 Resume Statistics

The download summary now includes resume information:

```
════════════════════════════════════════════════════════════
🎉 Download Summary
════════════════════════════════════════════════════════════
✅ Successful: 3/3
▶️ Resumed: 2/3
📏 Total size: 45.7 MB
⏱️ Total time: 12.3s
⚡ Average speed: 3.7 MB/s
════════════════════════════════════════════════════════════
```

## 🔒 Security Considerations

### **File Integrity**
- Uses ETag and Last-Modified headers for validation
- Detects server-side file changes
- Prevents resuming corrupted or modified files

### **Path Safety**
- Validates file paths to prevent directory traversal
- Secure metadata storage with hashed filenames
- Automatic permission handling

## 🌐 Server Compatibility

### **Supported Servers**
- ✅ Apache HTTP Server
- ✅ Nginx
- ✅ Microsoft IIS
- ✅ AWS S3
- ✅ Google Cloud Storage
- ✅ Most CDNs (CloudFlare, AWS CloudFront)

### **Requirements**
- Server must support HTTP Range requests
- Server should provide ETag or Last-Modified headers
- Content-Length header recommended for progress tracking

### **Fallback Behavior**
For servers that don't support resume:
- Automatically creates new file with timestamp
- Continues with normal download process
- Shows appropriate warning messages

## 🛠️ Troubleshooting

### **Common Issues**

**Resume not working?**
- Check if server supports range requests
- Verify file hasn't changed on server
- Ensure sufficient disk space

**Multiple downloads of same file?**
- Use `--list-resumable` to see existing downloads
- Check for metadata in `.nget-resume/` directory

**Metadata cleanup?**
- Old metadata (7+ days) is automatically cleaned
- Manual cleanup: `rm -rf .nget-resume/`

### **Debug Information**
Enable verbose output to see resume decisions:
```bash
# The tool automatically shows resume status
nget https://example.com/file.zip
# ▶️ [1/1] 📦 file.zip (10.2 MB) ▶️ Resuming from 6.8 MB
```

---

The resume feature makes n-get perfect for downloading large files over unreliable connections! 🚀