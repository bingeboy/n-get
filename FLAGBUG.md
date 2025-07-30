The Issue:

  Expected behavior:
  npx n-get https://httpbin.org/uuid -o test-uuid.json
  # Should create: test-uuid.json

  Actual behavior:
  npx n-get https://httpbin.org/uuid -o test-uuid.json
  # Actually creates: uuid (extracted from URL path)
  # Ignores the -o parameter completely

  Evidence from Testing:

  1. Multiple attempts with -o parameter:
  # All of these commands ignored the -o filename:
  npx n-get https://httpbin.org/json -o test-manual.json     # → created
  "json"
  npx n-get https://httpbin.org/json -o test-json-logs.json  # → created
  "json.2"
  npx n-get https://httpbin.org/uuid -o test-uuid.json       # → created
  "uuid"
  2. Filename extraction logic seems to override -o:
    - n-get appears to always extract filename from URL pathname using
  path.basename(urlPath)
    - The -o parameter is being ignored or overridden by internal filename
  logic

  What Should Happen (based on wget/curl behavior):

  wget https://httpbin.org/uuid -O custom-name.json  # Creates
  custom-name.json
  curl https://httpbin.org/uuid -o custom-name.json  # Creates
  custom-name.json

  From n-get Source Code:

  Looking at the downloadPipeline.js I read, line 367-368:
  const urlPath = new URL(url).pathname;
  const filename = path.basename(urlPath) || 'download';

  This suggests n-get is designed to extract filenames from URLs, but the
  -o parameter should override this behavior and it's not working as
  expected.

  Issue Details for Filing:

  - Expected: -o parameter should specify exact output filename
  - Actual: -o parameter is ignored, filename extracted from URL instead
  - Impact: Makes it impossible to specify custom filenames for downloads
  - Workaround: Currently none - you get whatever filename n-get extracts
  from the URL
