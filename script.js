// Get portal information for AGOL uploads
async function getPortalInfo(token) {
    logStatus('Getting portal information...');
    
    const portalUrl = 'https://www.arcgis.com/sharing/rest/portals/self';
    const params = new URLSearchParams({
        token: token,
        f: 'json'
    });
    
    try {
        const response = await fetch(`${portalUrl}?${params}`);
        const data = await response.json();
        
        if (data.portalHostname) {
            logStatus(`Portal hostname: ${data.portalHostname}`);
            return data;
        } else {
            throw new Error('Failed to get portal information');
        }
    } catch (error) {
        logStatus(`Portal info error: ${error.message}`);
        throw error;
    }
}

// Upload file to AGOL as content item
async function uploadFileToAGOL(file, authInfo) {
    logStatus(`Starting AGOL upload of ${file.name}...`);
    
    const addItemUrl = `${authInfo.portalUrl}/sharing/rest/content/users/${authInfo.username}/addItem`;
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', file.type === 'application/pdf' ? 'PDF' : 'Image');
    formData.append('title', file.name.replace(/\.[^/.]+$/, '')); // Remove extension
    formData.append('tags', 'AILocator,ProjectLimits');
    formData.append('description', `Uploaded by AILocator for project limits analysis`);
    formData.append('token', authInfo.token);
    formData.append('f', 'json');
    
    try {
        const response = await fetch(addItemUrl, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success && data.id) {
            logStatus(`File uploaded successfully. Item ID: ${data.id}`);
            return data.id;
        } else {
            throw new Error(data.error?.message || 'Upload failed');
        }
    } catch (error) {
        logStatus(`Upload error: ${error.message}`);
        throw error;
    }
}

// Share AGOL item publicly
async function shareItemPublic(authInfo, itemId) {
    logStatus(`Sharing item ${itemId} publicly...`);
    
    const shareUrl = `${authInfo.portalUrl}/sharing/rest/content/users/${authInfo.username}/items/${itemId}/share`;
    
    const params = new URLSearchParams({
        everyone: 'true',
        org: 'false',
        token: authInfo.token,
        f: 'json'
    });
    
    try {
        const response = await fetch(shareUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });
        
        const data = await response.json();
        
        if (data.itemId === itemId) {
            logStatus('Item shared publicly successfully');
            return true;
        } else {
            throw new Error('Failed to share item');
        }
    } catch (error) {
        logStatus(`Share error: ${error.message}`);
        throw error;
    }
}

// Get current authentication token
async function getCurrentToken() {
    return new Promise((resolve) => {
        require(["esri/identity/IdentityManager"], function(IdentityManager) {
            const credential = IdentityManager.findCredential("https://www.arcgis.com/sharing/rest");
            if (credential && credential.token) {
                resolve(credential.token);
            } else {
                resolve(null);
            }
        });
    });
}

// Add attachment to feature
async function addAttachmentToFeature(featureLayerUrl, objectId, file, token) {
    logStatus(`Adding attachment ${file.name} to feature ${objectId}...`);
    
    const attachmentUrl = `${featureLayerUrl}/${objectId}/addAttachment`;
    
    const formData = new FormData();
    formData.append('attachment', file);
    formData.append('token', token);
    formData.append('f', 'json');
    
    try {
        const response = await fetch(attachmentUrl, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.addAttachmentResult && data.addAttachmentResult.success) {
            logStatus(`Attachment added successfully. ID: ${data.addAttachmentResult.objectId}`);
            return data.addAttachmentResult.objectId;
        } else {
            throw new Error(data.error?.message || 'Failed to add attachment');
        }
    } catch (error) {
        logStatus(`Attachment error: ${error.message}`);
        throw error;
    }
}

// Upload PDF to Gemini File API and return file_uri
async function uploadPdfToGemini(file, aiKey) {
    logStatus('  Starting PDF upload to Gemini File API...');
    // Step 1: Start resumable upload
    const startUploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(aiKey)}`;
    let startRes;
    try {
        startRes = await fetch(startUploadUrl, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': file.size.toString(),
                'X-Goog-Upload-Header-Content-Type': file.type || 'application/pdf',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: { display_name: file.name } })
        });
    } catch (e) {
        logStatus(`  Error during initial Gemini upload request: ${e.message}`);
        throw new Error(`Network error or issue initiating Gemini upload: ${e.message}`);
    }

    if (!startRes.ok) {
        const errorText = await startRes.text();
        logStatus(`  Error starting Gemini upload (HTTP ${startRes.status}): ${errorText}`);
        throw new Error(`Failed to start Gemini upload: ${startRes.status} ${errorText}`);
    }

    const resumableUploadUrl = startRes.headers.get('X-Goog-Upload-URL');
    if (!resumableUploadUrl) {
        logStatus('  Error: Gemini upload URL not received from start response.');
        throw new Error('Failed to get Gemini upload URL from start response');
    }
    logStatus(`  Obtained resumable upload URL.`);

    // Step 2: Upload the PDF bytes and finalize
    logStatus('  Uploading PDF bytes...');
    let uploadRes;
    try {
        uploadRes = await fetch(resumableUploadUrl, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Command': 'upload, finalize',
                'X-Goog-Upload-Offset': '0'
                // Content-Length and Content-Type for the file body are typically handled by the browser
            },
            body: file
        });
    } catch (e) {
        logStatus(`  Error during PDF byte upload to Gemini: ${e.message}`);
        throw new Error(`Network error or issue uploading PDF bytes to Gemini: ${e.message}`);
    }

    if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        logStatus(`  Error uploading PDF to Gemini (HTTP ${uploadRes.status}): ${errorText}`);
        throw new Error(`Failed to upload PDF to Gemini: ${uploadRes.status} ${errorText}`);
    }

    let fileInfo;
    try {
        // The response of the 'upload, finalize' command should be the File metadata JSON
        fileInfo = await uploadRes.json();
    } catch (e) {
        // Try to get text if json parsing fails, as it might be an error message
        const responseText = await uploadRes.text().catch(() => "Could not get response text after JSON parse failure.");
        logStatus(`  Error parsing Gemini file upload response as JSON: ${e.message}. Response text: ${responseText}`);
        throw new Error(`Failed to parse Gemini file upload response: ${e.message}. Raw response: ${responseText}`);
    }
    
    logStatus('  PDF upload and finalization complete.');

    if (!fileInfo.file || !fileInfo.file.uri) {
        logStatus(`  Error: Gemini file upload response missing file URI. Response: ${JSON.stringify(fileInfo)}`);
        throw new Error('Failed to get file_uri from Gemini upload response. Full response: ' + JSON.stringify(fileInfo));
    }
    logStatus(`  Obtained file URI: ${fileInfo.file.uri}`);
    
    // Check if file has a state property and wait for it to be ACTIVE
    if (fileInfo.file.state) {
        logStatus(`  File state: ${fileInfo.file.state}`);
        
        // If file is not yet active, we should wait or poll
        if (fileInfo.file.state !== 'ACTIVE') {
            logStatus('  Waiting for file to be processed...');
            
            // Poll the file status up to 10 times with 1 second delays
            const maxAttempts = 10;
            for (let i = 0; i < maxAttempts; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                
                // Get file status
                const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${fileInfo.file.name}?key=${encodeURIComponent(aiKey)}`;
                try {
                    const statusRes = await fetch(statusUrl, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (statusRes.ok) {
                        const statusData = await statusRes.json();
                        logStatus(`  File state check ${i + 1}: ${statusData.state || 'unknown'}`);
                        
                        if (statusData.state === 'ACTIVE') {
                            logStatus('  File is now active and ready to use.');
                            break;
                        }
                    }
                } catch (e) {
                    logStatus(`  Warning: Could not check file status: ${e.message}`);
                }
                
                if (i === maxAttempts - 1) {
                    logStatus('  Warning: File may not be fully processed yet, but proceeding anyway.');
                }
            }
        }
    }
    
    return fileInfo.file.uri;
}
// --- Processing Log ---
const processingLog = document.getElementById('processing-log');
function logStatus(msg) {
    if (!processingLog) return;
    processingLog.textContent += msg + '\n';
    processingLog.scrollTop = processingLog.scrollHeight;
}
// Removed duplicate geocodeBtn declaration and showGeocodeBtn function
// --- AI & Geocoding Integration ---
const SPATIAL_REF = { wkid: 4326 };

// Gemini (Google) API integration using REST fetch (no SDK required)

// Unified function for both images and PDFs
async function analyzeFileWithGemini(file, aiKey) {
    const prompt_text = `You are an expert civil engineering assistant trained to analyze digital project plans (PDF or image) for municipal infrastructure projects.

Your task is to decipher the project limits from the plan set. The project limits can be a single site, a single street segment, or multiple disconnected parts.
The start is the best-identified starting location for the project. If the project is a street segment, this should be the intersection (e.g., "Main St and First St") closest to the project start. If the project is a single site or the limits are unclear, provide any street name or intersection found in the plans that can be geocoded to approximate the project location.
The finish is Optional. Only include this if the project is clearly and confidently identified as a single street segment with both start and end intersections clearly determined. This should be the intersection (e.g., "Main St and Second St") closest to the project end.
Exercise caution when determining road segment limits. If you are not confident about either the start or end intersection, do not attempt to define a segment. Instead, list only a clearly identified street name or intersection as a single point to avoid inaccurate or excessively large road segment definitions.
When looking for a location on a site plan don't forget to check the title block for a location description or site address. Make sure it is not the address of the organization that created the plans, but the actual project site address if available.
Road plans sometimes have an overall project limits sheet that shows the project limits for the entire project. If this is not available, use the plan pages that may be a sheet set made up of multiple sheets, each with a different section of the project.

Return a JSON object with the following fields, in this order:

- projectname: The name or title of the project as shown on the plans. This should be the main project name or title, if available. If not available, use the most descriptive name or title you can find.
- projectnumber: The project number or identifier as shown on the plans, if available.
- projectdate: The date of the project or the date shown on the plans, if available. Always return the date in the numeric format MM/DD/YYYY (e.g., "05/01/2025"). If the day is missing, use "01" as the day (e.g., "05/01/2025"). If the month is missing, use "01" as the month (e.g., "01/01/2025"). If the year is missing, set the field to null.
- notes: Any additional relevant information about the project limits or context found in the plans.
- parts: An array of objects, each object **in one of two forms**  
    Line part: { "start": "<intersection or address>", "finish": "<intersection or address>" }
    Point part: { "start": "<intersection or address>" }
    The array may contain any mix of line parts and point parts.

Instructions:
1. First, determine if the project limits describe a single street segment. If so, extract the names of the two closest cross streets at the start and end of the segment.
2. If the project is a single site or the limits are unclear, omit the finish field and only provide the start field with any street name or intersection found.
3. If the project consists of multiple disconnected parts, include each part in the parts array. Each part should be either a Line part (with both start and finish) or a Point part (with only start). If the project is a single street segment, return it as a single Line part with both start and finish.
4. When identifying street names, note that street name labels on plans often run parallel to the street orientation. The closest label to a street is not always the name of that street. Instead, look at the orientation of the road and then look along that road for its label in the same orientation. Use this to accurately match street names to their corresponding roads.
5. Be cautious and conservative: if there is any uncertainty about accurately defining both start and finish intersections for a road segment, default to using a single intersection or street name as a point part.
6. Always return the projectdate in the numeric format MM/DD/YYYY (e.g., "05/01/2025"). If the day is missing, use "01" as the day (e.g., "05/01/2025"). If the month is missing, use "01" as the month (e.g., "01/01/2025"). If the year is missing, set the field to null.
7. Return only a valid JSON object with the fields described above, in the order listed. Do not include any explanation or extra text.

Format your response as a JSON object with these fields only, in the order above. Do not include any extra text, markdown, or explanation.`;

    // JSON schema for structured output (see https://ai.google.dev/gemini-api/docs/structured-output?lang=rest)
    const response_schema = {
        type: "object",
        properties: {
            projectname:   { type: "string", nullable: true },
            projectnumber: { type: "string", nullable: true },
            projectdate:   { type: "string", nullable: true },
            notes:         { type: "string", nullable: true },
            parts: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        start:  { type: "string" },
                        finish: { type: "string", nullable: true }
                    },
                    required: ["start"],
                    propertyOrdering: ["start", "finish"]
                }
            }
        },
        required: ["projectname", "projectnumber", "projectdate", "notes", "parts"],
        propertyOrdering: ["projectname", "projectnumber", "projectdate", "notes", "parts"]
    };

    let aiResponseText = '';
    const generationConfig = {
        response_mime_type: "application/json",
        response_schema: response_schema
    };
    if (isPdfFile(file.name)) {
        // For PDFs under 20MB, use inline_data (base64) as per REST docs
        // Note: Gemini docs recommend using Files API when TOTAL request size (including prompt) > 20MB
        // We're using a conservative approach checking just the file size
        if (file.size < 20 * 1024 * 1024) {
            const base64Pdf = await fileToBase64(file);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(aiKey)}`;
            const body = {
                contents: [
                    {
                        parts: [
                            { inline_data: { mime_type: "application/pdf", data: base64Pdf } },
                            { text: prompt_text }
                        ]
                    }
                ],
                generationConfig
            };
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            aiResponseText = await response.text();
        } else {
            // For large PDFs, use the File API (file_uri) with the newest model
            logStatus('  File is larger than 20MB, using File API for PDF.');
            const fileUri = await uploadPdfToGemini(file, aiKey); // This will log its own progress/errors
            logStatus(`  File uploaded, URI: ${fileUri}. Now calling generateContent.`);

            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(aiKey)}`;
            // Per Gemini docs, for large PDFs, prompt (text) should come first, then file_data
            const body = {
                contents: [
                    {
                        parts: [
                            { text: prompt_text },
                            { file_data: { mime_type: file.type || "application/pdf", file_uri: fileUri } }
                        ]
                    }
                ],
                generationConfig
            };

            let genResponse; // Renamed to avoid conflict with 'response' in outer scope if any confusion
            try {
                genResponse = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body)
                });
            } catch (e) {
                logStatus(`  Network error during Gemini generateContent call: ${e.message}`);
                throw new Error(`Network error calling Gemini generateContent: ${e.message}`);
            }
            
            aiResponseText = await genResponse.text(); // Get raw response text for logging / non-JSON cases

            if (!genResponse.ok) {
                logStatus(`  Gemini API generateContent error (HTTP ${genResponse.status}):`);
                logStatus(`  Response: ${aiResponseText}`);
                throw new Error(`Gemini API generateContent request failed with status ${genResponse.status}. Response: ${aiResponseText}`);
            }

            const contentType = genResponse.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                logStatus('  Gemini API generateContent error (non-JSON response):');
                logStatus(`  Content-Type: ${contentType}`);
                logStatus(`  Response: ${aiResponseText}`);
                throw new Error(`Gemini API returned non-JSON content type ('${contentType}') for large PDF. Response: ${aiResponseText}`);
            }
            
            // If we reach here, genResponse.ok is true and contentType is application/json.
            // aiResponseText should be the valid JSON string from the API.
            logStatus('  Gemini generateContent call successful for large PDF.');
        }
    } else {
        // Image: use base64 inline_data as before
        const base64Image = await fileToBase64(file);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(aiKey)}`;
        const body = {
            contents: [
                {
                    parts: [
                        { text: prompt_text },
                        { inline_data: { mime_type: "image/jpeg", data: base64Image } }
                    ]
                }
            ],
            generationConfig
        };
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        aiResponseText = await response.text();
    }

    // Try to extract the structured JSON from the AI response
    let jsonText = null;
    // Try to parse as direct JSON (if using response_schema in future)
    try {
        const parsed = JSON.parse(aiResponseText);
        // If the response is a Gemini API envelope, extract the JSON from the text part
        if (parsed.candidates && parsed.candidates[0]?.content?.parts?.[0]?.text) {
            jsonText = parsed.candidates[0].content.parts[0].text.trim();
        } else {
            // Already a direct JSON object
            jsonText = aiResponseText;
        }
    } catch (e) {
        // Not a direct JSON object, treat as text
        jsonText = aiResponseText.trim();
    }

    // Remove markdown/code block wrappers if present
    if (jsonText.startsWith("```")) {
        jsonText = jsonText.split("```", 2)[1] || jsonText;
        if (jsonText.trim().startsWith("json")) {
            jsonText = jsonText.trim().slice(4);
        }
        jsonText = jsonText.trim();
    }

    // Parse the actual JSON
    let data;
    try {
        data = JSON.parse(jsonText);
    } catch (e) {
        logStatus('AI response could not be parsed as JSON.');
        logStatus('Raw AI response text: ' + jsonText);
        logStatus('Parse error: ' + (e && e.message ? e.message : e));
        return null;
    }
    // Display only the structured output in the Processing Log
    logStatus('AI Structured Output:');
    logStatus(JSON.stringify(data, null, 2));
    return data;
}


// Helper: convert File/Blob to base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(",")[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
const MAX_INDIVIDUAL_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ZIP_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const AGOL_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB for AGOL uploads
const signOutBtn = document.getElementById('sign-out-btn');

function showSignOut(show) {
    signOutBtn.style.display = show ? '' : 'none';
}

// --- ArcGIS Online sign-in logic ---
const checkBtn = document.getElementById('check-credentials-btn');
const aiKeyInput = document.getElementById('ai-key-input');
const checkAIButton = document.getElementById('check-ai-btn');
const geocodeBtn = document.getElementById('geocode-btn');
const locationDetailsInput = document.getElementById('location-details-input');

// State tracking for enabling Geocode button
let aiKeyIsValid = false;
let agolIsSignedIn = false;
let fileIsUploaded = false;

function updateGeocodeBtnVisibility() {
    const locationDetails = locationDetailsInput ? locationDetailsInput.value.trim() : '';
    if (aiKeyIsValid && agolIsSignedIn && fileIsUploaded && locationDetails) {
        geocodeBtn.style.display = '';
    } else {
        geocodeBtn.style.display = 'none';
    }
}

function showAICheckPill(text) {
    checkAIButton.textContent = text;
    checkAIButton.classList.add('ai-check-pill');
    checkAIButton.style.background = '#28a745';
    checkAIButton.style.color = '#fff';
    checkAIButton.style.fontWeight = 'bold';
    aiKeyIsValid = true;
    updateGeocodeBtnVisibility();
}
function showAICheckFail() {
    checkAIButton.textContent = 'Try Again Check Key';
    checkAIButton.classList.remove('ai-check-pill');
    checkAIButton.style.background = '';
    checkAIButton.style.color = '';
    checkAIButton.style.fontWeight = '';
    aiKeyIsValid = false;
    updateGeocodeBtnVisibility();
}
function resetAICheckPill() {
    checkAIButton.textContent = 'Check AI';
    checkAIButton.classList.remove('ai-check-pill');
    checkAIButton.style.background = '';
    checkAIButton.style.color = '';
    checkAIButton.style.fontWeight = '';
    aiKeyIsValid = false;
    updateGeocodeBtnVisibility();
}

checkAIButton.addEventListener('click', async function() {
    resetAICheckPill();
    const aiKey = aiKeyInput.value.trim();
    if (!aiKey) {
        showAICheckFail();
        return;
    }
    checkAIButton.textContent = 'Checking...';
    checkAIButton.classList.remove('ai-check-pill');
    checkAIButton.style.background = '';
    checkAIButton.style.color = '';
    checkAIButton.style.fontWeight = '';
    checkAIButton.disabled = true;
    try {
        // Use Gemini API with a silly prompt
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(aiKey)}`;
        const body = {
            contents: [
                { parts: [ { text: 'Reply with three silly words to prove you are alive.' } ] }
            ]
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        // Check for error or missing/empty candidates
        if (data.error || !data.candidates || !Array.isArray(data.candidates) || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0] || !data.candidates[0].content.parts[0].text) {
            showAICheckFail();
        } else {
            let text = data.candidates[0].content.parts[0].text.trim();
            if (text.startsWith('```')) {
                text = text.split('```', 2)[1] || text;
                text = text.trim();
            }
            if (text.length > 40) text = text.slice(0, 40) + '...';
            showAICheckPill(text);
        }
    } catch (e) {
        showAICheckFail();
    } finally {
        checkAIButton.disabled = false;
    }
});

const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');


function setButtonState(signedIn, fullName) {
    agolIsSignedIn = !!signedIn;
    if (signedIn) {
        checkBtn.textContent = 'Signed into AGOL' + (fullName ? ` as ${fullName}` : '');
        checkBtn.style.background = '#28a745';
        checkBtn.style.color = '#fff';
        checkBtn.disabled = true;
        showSignOut(true);
    } else {
        // If last attempt failed, show retry text, else default
        if (setButtonState.lastTried && !setButtonState.lastSuccess) {
            checkBtn.textContent = 'Try Sign In Again';
        } else {
            checkBtn.textContent = 'Check Credentials';
        }
        checkBtn.style.background = '';
        checkBtn.style.color = '';
        checkBtn.disabled = false;
        showSignOut(false);
    }
    updateGeocodeBtnVisibility();
}

geocodeBtn.addEventListener('click', async function() {
    if (this.textContent === 'Complete') {
        // Clear log, file info, and reset state
        if (processingLog) {
            processingLog.textContent = '';
        }
        // Assuming 'fileInfo' is the DOM element container for the file list
        if (typeof fileInfo !== 'undefined' && fileInfo) {
            fileInfo.innerHTML = '<p>Filename will appear here</p>';
        }
        window.lastDroppedFiles = [];
        fileIsUploaded = false; // Reset file upload state

        this.textContent = 'Geocode'; // Reset button text
        // geocodeBtn.disabled is already false if textContent was 'Complete'
        
        updateGeocodeBtnVisibility(); // Update button visibility based on new state
        return; // Stop further execution, do not reprocess
    }

    this.textContent = 'Working';
    this.disabled = true;
    if (processingLog) {
        processingLog.textContent = ''; // Clear log for new processing
    }
    logStatus('--- AI File Analysis Started ---');

    // Find uploaded file(s) from fileInfo (UI) and process
    let fileList = [];
    // Assuming 'fileInfo' is the DOM element container for the file list
    if (typeof fileInfo !== 'undefined' && fileInfo) {
        const fileInfoList = fileInfo.querySelector('ul');
        if (fileInfoList) {
            fileList = Array.from(fileInfoList.querySelectorAll('li')).map(li => li.textContent);
        }
    }

    if (fileList.length === 0) {
        logStatus('No files to process.');
        geocodeBtn.textContent = 'Complete';
        geocodeBtn.disabled = false;
        return;
    }

    const aiKey = aiKeyInput.value.trim();
    for (const fname of fileList) {
        logStatus(`Processing: ${fname}`);
        try {
            // Find the File object from the input (drag/drop)
            let fileObj = null;
            if (window.lastDroppedFiles && window.lastDroppedFiles.length) {
                fileObj = Array.from(window.lastDroppedFiles).find(f => f.name === fname);
            }
            if (!fileObj) {
                logStatus(`  Error: File object for ${fname} not found.`);
                continue;
            }
            // Analyze with Gemini (image or PDF)
            logStatus('  Reading file...');
            let aiData = null;
            try {
                aiData = await analyzeFileWithGemini(fileObj, aiKey);
                logStatus('  AI analysis complete.');
            } catch (e) {
                logStatus('  Error: Failed to analyze file with AI.');
                if (e && e.message) {
                    logStatus('  AI Error Details:\n' + e.message.replace(/\n/g, '\n  '));
                } else {
                    logStatus('  AI Error Details: ' + e);
                }
                console.error("AI Analysis Error Stack:", e);
                continue;
            }

                        // --- Geocode start-&-finish, then buffer & area ----------------------------
                        // >>>>>>>>>>>>>>>>>  MULTI-PART LOGIC REPLACEMENT  >>>>>>>>>>>>>>>>>>
                        if (aiData && Array.isArray(aiData.parts) && aiData.parts.length) {
                            // Get user location details to append
                            const locationDetails = locationDetailsInput && locationDetailsInput.value ? locationDetailsInput.value.trim() : '';

                            require([
                                "esri/rest/locator",
                                "esri/geometry/Point",
                                "esri/geometry/Polyline",
                                "esri/geometry/SpatialReference",
                                "esri/geometry/geometryEngine",
                                "esri/geometry/operators/geodesicBufferOperator",
                                "esri/request"
                            ], function (
                                locator,
                                Point,
                                Polyline,
                                SpatialReference,
                                geometryEngine,
                                geodesicBufferOperator,
                                esriRequest
                            ) {

                                const locatorUrl = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
                                const sr = new SpatialReference({ wkid: 4326 });

                                // Helper to append location details if present
                                const appendLoc = addr => {
                                    if (!addr) return addr;
                                    return locationDetails ? (addr + ' ' + locationDetails) : addr;
                                };

                                const geocodeOne = addr =>
                                    locator.addressToLocations(locatorUrl, {
                                        address: { SingleLine: addr },
                                        maxLocations: 1,
                                        outFields: ["*"]
                                    }).then(r => r[0]?.location || null);

                                // Geocode every part, appending location info
                                const geoPromises = aiData.parts.map(p =>
                                    p.start
                                        ? Promise.all([
                                            geocodeOne(appendLoc(p.start)),
                                            geocodeOne(p.finish ? appendLoc(p.finish) : null)
                                        ])
                                        : geocodeOne(p.location ? appendLoc(p.location) : null)
                                );

                                Promise.all(geoPromises).then(async results => {
                                    await geodesicBufferOperator.load();

                                    const buffers = [];
                                    const bufDist = 10, opt = { unit: "meters" };

                                    results.forEach((res, i) => {
                                        const part = aiData.parts[i];
                                        let g = null;

                                        if (Array.isArray(res)) { // A part with a 'start' property was geocoded
                                            const [s, e] = res;
                                            if (s && e) { // Both start and end geocoded successfully -> Polyline
                                                g = new Polyline({
                                                    paths: [[[s.x, s.y], [e.x, e.y]]],
                                                    spatialReference: sr
                                                });
                                            } else if (s) { // Only start geocoded successfully -> Point
                                                g = new Point({ x: s.x, y: s.y, spatialReference: sr });
                                            }
                                        } else if (res) { // A part with a 'location' property was geocoded
                                            g = new Point({ x: res.x, y: res.y, spatialReference: sr });
                                        }

                                        if (g) {
                                            const b = geodesicBufferOperator.execute(g, bufDist, opt);
                                            if (b) buffers.push(b);
                                        }
                                    });

                                    if (!buffers.length) { logStatus("  No valid buffers."); return; }

                                    // Union all buffers
                                    const unioned = buffers.length === 1 ? buffers[0]
                                        : geometryEngine.union(buffers);

                                    const area = geometryEngine.geodesicArea(unioned, "square-meters");
                                    logStatus(`  Unioned buffer area: ${area.toFixed(0)} m²`);

                                    // Add to feature layer
                                    const feature = {
                                        geometry: unioned.toJSON(),
                                        attributes: {
                                            projectname:   aiData.projectname   || null,
                                            projectnumber: aiData.projectnumber || null,
                                            projectdate:   aiData.projectdate   || null,
                                            notes:         aiData.notes         || null,
                                            parts_json:    JSON.stringify(aiData.parts),
                                            Link:          null  // Will be populated if files are uploaded to AGOL
                                        }
                                    };

                                    // Get the feature layer URL from input
                                    const featureLayerUrl = document.getElementById('feature-layer-url').value.trim();
                                    const addUrl = `${featureLayerUrl}/addFeatures`;
                                    
                                    // Get authentication token for the request
                                    const token = await getCurrentToken();
                                    const queryParams = { 
                                        f: "json", 
                                        features: JSON.stringify([feature])
                                    };
                                    if (token) {
                                        queryParams.token = token;
                                    }
                                    
                                    esriRequest(addUrl, {
                                        method: "post",
                                        query: queryParams,
                                        responseType: "json"
                                    }).then(async r => {
                                        if (r.data?.addResults?.[0]?.success) {
                                            logStatus("Project Added to Layer");
                                            const objectId = r.data.addResults[0].objectId;
                                            logStatus(`  Feature Object ID: ${objectId}`);
                                            
                                            // Handle file uploads based on selected option
                                            const uploadOption = document.querySelector('input[name="upload-option"]:checked')?.value || '1';
                                            const files = window.lastDroppedFiles || [];
                                            
                                            if (files.length > 0) {
                                                logStatus(`Processing ${files.length} file(s) with upload option ${uploadOption}...`);
                                                
                                                // Get current token
                                                const token = await getCurrentToken();
                                                if (!token) {
                                                    logStatus("  Error: No authentication token available for uploads");
                                                    return;
                                                }
                                                
                                                // Get portal info for AGOL uploads
                                                let authInfo = null;
                                                if (uploadOption === '1' || uploadOption === '2') {
                                                    const portalInfo = await getPortalInfo(token);
                                                    authInfo = {
                                                        token: token,
                                                        username: usernameInput.value.trim(),
                                                        portalUrl: portalInfo.portalHostname ? `https://${portalInfo.portalHostname}` : 'https://www.arcgis.com'
                                                    };
                                                }
                                                
                                                const uploadedLinks = [];
                                                
                                                for (const file of files) {
                                                    try {
                                                        if (uploadOption === '1') {
                                                            // Option 1: Attach files under 10MB, upload larger to AGOL
                                                            if (file.size <= MAX_INDIVIDUAL_FILE_SIZE) {
                                                                await addAttachmentToFeature(featureLayerUrl, objectId, file, token);
                                                            } else {
                                                                const itemId = await uploadFileToAGOL(file, authInfo);
                                                                await shareItemPublic(authInfo, itemId);
                                                                const dataUrl = `${authInfo.portalUrl}/sharing/rest/content/items/${itemId}/data`;
                                                                uploadedLinks.push(dataUrl);
                                                            }
                                                        } else if (uploadOption === '2') {
                                                            // Option 2: Upload all files to AGOL
                                                            const itemId = await uploadFileToAGOL(file, authInfo);
                                                            await shareItemPublic(authInfo, itemId);
                                                            const dataUrl = `${authInfo.portalUrl}/sharing/rest/content/items/${itemId}/data`;
                                                            uploadedLinks.push(dataUrl);
                                                        } else if (uploadOption === '3') {
                                                            // Option 3: Only attach files under 10MB
                                                            if (file.size <= MAX_INDIVIDUAL_FILE_SIZE) {
                                                                await addAttachmentToFeature(featureLayerUrl, objectId, file, token);
                                                            } else {
                                                                logStatus(`  Skipping ${file.name} (exceeds 10MB limit for option 3)`);
                                                            }
                                                        }
                                                    } catch (error) {
                                                        logStatus(`  Error processing ${file.name}: ${error.message}`);
                                                    }
                                                }
                                                
                                                // Update Link field if we uploaded files to AGOL
                                                if (uploadedLinks.length > 0) {
                                                    const linkValue = uploadedLinks.join(', ');
                                                    logStatus(`Updating Link field with ${uploadedLinks.length} URL(s)...`);
                                                    
                                                    const updateUrl = `${featureLayerUrl}/updateFeatures`;
                                                    const updateFeature = {
                                                        attributes: {
                                                            OBJECTID: objectId,
                                                            Link: linkValue
                                                        }
                                                    };
                                                    
                                                    try {
                                                        const updateResponse = await esriRequest(updateUrl, {
                                                            method: "post",
                                                            query: { 
                                                                f: "json", 
                                                                features: JSON.stringify([updateFeature]),
                                                                token: token
                                                            },
                                                            responseType: "json"
                                                        });
                                                        
                                                        if (updateResponse.data?.updateResults?.[0]?.success) {
                                                            logStatus("Link field updated successfully");
                                                        } else {
                                                            logStatus("  Error updating Link field: " + JSON.stringify(updateResponse.data?.updateResults?.[0]?.error));
                                                        }
                                                    } catch (err) {
                                                        logStatus("  Error updating feature: " + (err.message || err));
                                                    }
                                                }
                                                
                                                logStatus("File processing complete");
                                            }
                                        } else {
                                            logStatus("  Error: Feature not added.");
                                            logStatus("  Layer Add Error: " + JSON.stringify(r.data?.addResults?.[0]?.error));
                                        }
                                    }).catch(err => {
                                        logStatus("  Error adding feature: " + (err.message || err));
                                    });
                                });
                            });
                        }
                        // <<<<<<<<<<<<<<<<<  END MULTI-PART LOGIC REPLACEMENT  <<<<<<<<<<<<<<<<<

        } catch (e) {
            logStatus(`  Error processing ${fname}: ${e}`);
        }
    }
    logStatus('--- AI File Analysis Complete ---');
    this.textContent = 'Complete';
    this.disabled = false;
});

// Track last sign-in attempt for button text
setButtonState.lastTried = false;
setButtonState.lastSuccess = false;
signOutBtn.addEventListener('click', function() {
    require(["esri/identity/IdentityManager"], function(IdentityManager) {
        IdentityManager.destroyCredentials();
        setButtonState(false, '');
    });
});

checkBtn.addEventListener('click', function() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
        alert('Please enter both username and password.');
        return;
    }
    checkBtn.textContent = 'Signing in...';
    checkBtn.disabled = true;
    setButtonState.lastTried = true;
    require(["esri/identity/IdentityManager", "esri/request"], function(IdentityManager, esriRequest) {
        IdentityManager.registerToken({
            server: "https://www.arcgis.com/sharing/rest",
            userId: username,
            token: null,
            expires: 0
        });
        esriRequest(
            "https://www.arcgis.com/sharing/rest/generateToken",
            {
                method: "post",
                query: {
                    username: username,
                    password: password,
                    referer: window.location.origin,
                    f: "json"
                },
                responseType: "json"
            }
        ).then(function(response) {
            if (response.data && response.data.token) {
                setButtonState.lastSuccess = true;
                IdentityManager.registerToken({
                    server: "https://www.arcgis.com/sharing/rest",
                    userId: username,
                    token: response.data.token,
                    expires: response.data.expires
                });
                // Fetch user info to get first name
                esriRequest(
                    "https://www.arcgis.com/sharing/rest/community/self",
                    {
                        query: { f: "json", token: response.data.token },
                        responseType: "json"
                    }
                ).then(function(userResp) {
                    let fullName = '';
                    if (userResp.data && userResp.data.fullName) {
                        fullName = userResp.data.fullName;
                    }
                    setButtonState(true, fullName);
                }).catch(function() {
                    setButtonState(true, '');
                });
            } else {
                setButtonState.lastSuccess = false;
                setButtonState(false);
                alert('Sign in failed. Please check your credentials.');
            }
        }).catch(function() {
            setButtonState.lastSuccess = false;
            setButtonState(false);
            alert('Sign in failed. Please check your credentials.');
        });
    });
});
// --- Animated Orbs Background ---
const canvas = document.getElementById('orbs-bg');
const ctx = canvas.getContext('2d');
let orbs = [];
const ORB_COUNT = 70;
const ORB_MIN_RADIUS = 3;
const ORB_MAX_RADIUS = 9;
const ORB_MIN_SPEED = 0.2;
const ORB_MAX_SPEED = 0.7;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function randomBetween(a, b) {
    return a + Math.random() * (b - a);
}

function createOrbs() {
    orbs = [];
    for (let i = 0; i < ORB_COUNT; i++) {
        const radius = randomBetween(ORB_MIN_RADIUS, ORB_MAX_RADIUS);
        const x = randomBetween(radius, canvas.width - radius);
        const y = randomBetween(radius, canvas.height - radius);
        const angle = Math.random() * 2 * Math.PI;
        const speed = randomBetween(ORB_MIN_SPEED, ORB_MAX_SPEED);
        orbs.push({
            x, y, radius,
            dx: Math.cos(angle) * speed,
            dy: Math.sin(angle) * speed,
            alpha: randomBetween(0.3, 0.7)
        });
    }
}

function animateOrbs() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const orb of orbs) {
        // Move orb
        orb.x += orb.dx;
        orb.y += orb.dy;
        // Bounce off edges
        if (orb.x - orb.radius < 0 || orb.x + orb.radius > canvas.width) {
            orb.dx *= -1;
        }
        if (orb.y - orb.radius < 0 || orb.y + orb.radius > canvas.height) {
            orb.dy *= -1;
        }
        // Draw orb
        ctx.save();
        ctx.globalAlpha = orb.alpha;
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#c61f3f'; // Updated orb color
        ctx.shadowColor = '#c61f3f'; // Updated glow color
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.restore();
    }
    requestAnimationFrame(animateOrbs);
}

createOrbs();
animateOrbs();
window.addEventListener('resize', () => {
    resizeCanvas();
    createOrbs();
});
// --- End Animated Orbs Background ---

const dropZone = document.getElementById('drop-zone');
const fileInfo = document.getElementById('file-info');
const fileInfoP = fileInfo.querySelector('p');

const IMAGE_EXTENSIONS = [
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'
];
const PDF_EXTENSION = '.pdf';

function isImageFile(name) {
    const lower = name.toLowerCase();
    return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function isPdfFile(name) {
    return name.toLowerCase().endsWith(PDF_EXTENSION);
}

// Prevent default drag behaviors
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false); // Prevent browser opening file
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// Highlight drop zone when item is dragged over it
['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, unhighlight, false);
});

function highlight(e) {
    dropZone.classList.add('dragover');
}

function unhighlight(e) {
    dropZone.classList.remove('dragover');
}

// Handle dropped files
dropZone.addEventListener('drop', handleDrop, false);

// Store dropped files globally for geocoding
window.lastDroppedFiles = [];

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    window.lastDroppedFiles = [];

    if (files.length > 0) {
        const file = files[0];
        if (file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')) {
            if (file.size > MAX_ZIP_FILE_SIZE) {
                fileInfo.innerHTML = '<p>Zip file is too large. Maximum allowed size is 100MB.</p>';
                fileIsUploaded = false;
                updateGeocodeBtnVisibility();
                return;
            }
            // Handle zip file
            handleZipFile(file);
        } else if (file.type.startsWith('image/') || isImageFile(file.name)) {
            const uploadOption = document.querySelector('input[name="upload-option"]:checked')?.value || '1';
            const maxSize = (uploadOption === '2') ? AGOL_MAX_FILE_SIZE : MAX_INDIVIDUAL_FILE_SIZE;
            
            if (file.size > AGOL_MAX_FILE_SIZE) {
                fileInfo.innerHTML = '<p>File is too large. Maximum allowed size is 100MB.</p>';
                fileIsUploaded = false;
                updateGeocodeBtnVisibility();
                return;
            }
            
            if (uploadOption === '3' && file.size > MAX_INDIVIDUAL_FILE_SIZE) {
                fileInfo.innerHTML = '<p>File is too large for attachment. Maximum allowed size is 10MB for option 3.</p>';
                fileIsUploaded = false;
                updateGeocodeBtnVisibility();
                return;
            }
            // Single image file
            fileInfo.innerHTML = `<p>Received 1 image file:</p><ul><li>${file.name}</li></ul>`;
            window.lastDroppedFiles = [file];
            fileIsUploaded = true;
            updateGeocodeBtnVisibility();
        } else if (file.type === 'application/pdf' || isPdfFile(file.name)) {
            const uploadOption = document.querySelector('input[name="upload-option"]:checked')?.value || '1';
            const maxSize = (uploadOption === '2') ? AGOL_MAX_FILE_SIZE : MAX_INDIVIDUAL_FILE_SIZE;
            
            if (file.size > AGOL_MAX_FILE_SIZE) {
                fileInfo.innerHTML = '<p>File is too large. Maximum allowed size is 100MB.</p>';
                fileIsUploaded = false;
                updateGeocodeBtnVisibility();
                return;
            }
            
            if (uploadOption === '3' && file.size > MAX_INDIVIDUAL_FILE_SIZE) {
                fileInfo.innerHTML = '<p>File is too large for attachment. Maximum allowed size is 10MB for option 3.</p>';
                fileIsUploaded = false;
                updateGeocodeBtnVisibility();
                return;
            }
            // Single PDF file
            fileInfo.innerHTML = `<p>Received 1 PDF file:</p><ul><li>${file.name}</li></ul>`;
            window.lastDroppedFiles = [file];
            fileIsUploaded = true;
            updateGeocodeBtnVisibility();
        } else {
            fileInfo.innerHTML = '<p>Please drop an image, PDF, or a zip containing images or PDFs.</p>';
            fileIsUploaded = false;
            updateGeocodeBtnVisibility();
        }
    } else {
        fileInfo.innerHTML = '<p>No file dropped.</p>';
        fileIsUploaded = false;
        updateGeocodeBtnVisibility();
    }
}

function handleZipFile(file) {
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const zip = await JSZip.loadAsync(e.target.result);
            const imageFiles = [];
            const pdfFiles = [];
            const fileBlobs = [];
            const promises = [];
            const oversizedFiles = [];
            zip.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir && (isImageFile(zipEntry.name) || isPdfFile(zipEntry.name))) {
                    promises.push(zipEntry.async('blob').then(blob => {
                        const uploadOption = document.querySelector('input[name="upload-option"]:checked')?.value || '1';
                        
                        if (blob.size > AGOL_MAX_FILE_SIZE) {
                            oversizedFiles.push({ name: zipEntry.name, size: blob.size });
                        } else if (uploadOption === '3' && blob.size > MAX_INDIVIDUAL_FILE_SIZE) {
                            oversizedFiles.push({ name: zipEntry.name, size: blob.size });
                        } else {
                            if (isImageFile(zipEntry.name)) imageFiles.push(zipEntry.name);
                            if (isPdfFile(zipEntry.name)) pdfFiles.push(zipEntry.name);
                            // Create a File object if possible, else fallback to Blob with name
                            let f;
                            try {
                                f = new File([blob], zipEntry.name, { type: blob.type });
                            } catch {
                                f = blob;
                                f.name = zipEntry.name;
                            }
                            fileBlobs.push(f);
                        }
                    }));
                }
            });
            await Promise.all(promises);

            let message = '';
            if (oversizedFiles.length > 0) {
                const uploadOption = document.querySelector('input[name="upload-option"]:checked')?.value || '1';
                const sizeLimit = uploadOption === '3' ? '10MB' : '100MB';
                const errorMessages = oversizedFiles.map(f => `<li>${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)</li>`).join('');
                message += `<p>The following files inside the zip exceed the ${sizeLimit} limit and were ignored:</p><ul>${errorMessages}</ul>`;
            }

            const totalFiles = imageFiles.length + pdfFiles.length;
            if (totalFiles > 0) {
                let summary = [];
                if (imageFiles.length > 0) summary.push(`${imageFiles.length} image file${imageFiles.length > 1 ? 's' : ''}`);
                if (pdfFiles.length > 0) summary.push(`${pdfFiles.length} PDF file${pdfFiles.length > 1 ? 's' : ''}`);
                if (message) {
                    message += '<br>';
                }
                message += `<p>Received ${summary.join(' and ')}:</p><ul>${[...imageFiles, ...pdfFiles].map(name => `<li>${name}</li>`).join('')}</ul>`;
                window.lastDroppedFiles = fileBlobs;
                fileIsUploaded = true;
            } else if (oversizedFiles.length === 0) {
                message = '<p>No image or PDF files found in the zip.</p>';
                window.lastDroppedFiles = [];
                fileIsUploaded = false;
            }
            
            fileInfo.innerHTML = message;
            updateGeocodeBtnVisibility();
        } catch (err) {
            fileInfo.innerHTML = '<p>Error reading zip file.</p>';
            window.lastDroppedFiles = [];
            fileIsUploaded = false;
            updateGeocodeBtnVisibility();
        }
    };
    reader.readAsArrayBuffer(file);
}
