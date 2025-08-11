# Processing Error Fix for Large PDF Files

## Issue Description
PDF files larger than 50MB fail during Gemini API processing with an unhelpful "Unsupported file uri" error, even though the file uploads successfully to the Files API.

### Error Message
```
Gemini API generateContent error (HTTP 400):
Response: {
  "error": {
    "code": 400,
    "message": "Unsupported file uri: files/7imxwc94vtie",
    "status": "INVALID_ARGUMENT"
  }
}
```

## Root Cause
**Gemini 2.5 Flash has a 50MB limit for PDF files at inference time**, even though the Files API can store files up to 2GB. When a PDF larger than 50MB is passed to `:generateContent`, the model returns the misleading error "Unsupported file uri" instead of clearly indicating a size limit violation.

### Key API Limits
- **Files API storage**: Up to 20GB per project, 2GB per file
- **Gemini 2.5 PDF processing**: Maximum 50MB per file, 1000 pages per file
- **Discrepancy**: The Files API happily accepts and stores PDFs over 50MB, but Gemini models reject them during inference

## Solution
Added a 49MB file size check before allowing PDF uploads (using 49MB instead of 50MB as a safety margin to avoid rounding issues).

### Code Changes

#### 1. Added constant for the limit (line 500):
```javascript
const MAX_PDF_SIZE_FOR_GEMINI = 49 * 1024 * 1024; // 49 MB limit (safe margin for Gemini's 50MB limit)
```

#### 2. Check single PDF files on drop (lines 1188-1194):
```javascript
// Check Gemini limit for PDFs (49MB to be safe)
if (file.size > MAX_PDF_SIZE_FOR_GEMINI) {
    fileInfo.innerHTML = `<p>PDF file is too large for AI processing. Maximum allowed size is 49MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.</p>`;
    fileIsUploaded = false;
    updateGeocodeBtnVisibility();
    return;
}
```

#### 3. Check PDFs extracted from ZIP files (lines 1241-1243):
```javascript
// Check PDF size limit for Gemini (49MB to be safe)
if (isPdfFile(zipEntry.name) && blob.size > MAX_PDF_SIZE_FOR_GEMINI) {
    oversizedFiles.push({ name: zipEntry.name, size: blob.size, reason: 'PDF exceeds 49MB AI processing limit' });
}
```

## User Impact
- Users now get a clear error message when attempting to upload PDFs over 49MB
- The error is caught early, before wasting time uploading to the Files API
- Message shows the actual file size to help users understand how much they need to reduce
- Using 49MB instead of 50MB provides a safety margin against rounding errors

## Alternative Solutions (Not Implemented)
If you need to process PDFs larger than 50MB, consider:
1. **Compress the PDF**: Downsample images, remove unnecessary elements
2. **Split the PDF**: Break into multiple files under 50MB each
3. **Use a different model**: Check if other Gemini models have higher limits

## Testing
After applying this fix:
1. Test with a PDF exactly at 50MB (should be rejected)
2. Test with a PDF at 49MB (should be accepted)  
3. Test with PDFs in ZIP files over 50MB (should show exclusion message)
4. Verify the file size is displayed in error messages

## References
- [Google Cloud Gemini PDF limits](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/document-understanding#gemini-limits) - Explicitly states 50MB/file limit
- [Gemini Files API documentation](https://ai.google.dev/gemini-api/docs/prompting_with_media) - Shows 2GB storage limit but not inference limits