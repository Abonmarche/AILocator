// Upload PDF to Gemini File API and return file_uri
async function uploadPdfToGemini(file, aiKey) {
    // Step 1: Start resumable upload
    const startRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(aiKey)}`,
        {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': file.size,
                'X-Goog-Upload-Header-Content-Type': 'application/pdf',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: { display_name: file.name } })
        });
    const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) throw new Error('Failed to get Gemini upload URL');
    // Step 2: Upload the PDF bytes
    await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Content-Length': file.size,
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize'
        },
        body: file
    });
    // Step 3: Get file_uri from Gemini
    const fileInfoRes = await fetch(uploadUrl, {
        method: 'GET'
    });
    const fileInfo = await fileInfoRes.json();
    if (!fileInfo.file || !fileInfo.file.uri) throw new Error('Failed to get file_uri from Gemini');
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
const FEATURE_LAYER_URL = "https://services6.arcgis.com/o5a9nldztUcivksS/arcgis/rest/services/ProjectLimits/FeatureServer";
const SPATIAL_REF = { wkid: 4326 };

// Gemini (Google) API integration using REST fetch (no SDK required)

// Unified function for both images and PDFs
async function analyzeFileWithGemini(file, aiKey) {
    const prompt_text = `You are an expert civil engineering assistant trained to analyze digital project plans (PDF or image) for municipal infrastructure projects.

Your task is to decipher the project limits from the plan set and return a JSON object with the following fields:

- start: The best-identified starting location for the project. If the project is a street segment, this should be the intersection (e.g., "Main St and First St") closest to the project start. If the project is not a single street segment or the limits are unclear, provide any street name or intersection found in the plans that can be geocoded to approximate the project location.
- finish: (Optional) The best-identified ending location for the project. Only include this if the project is a single street segment and both start and end can be determined. This should be the intersection (e.g., "Main St and Second St") closest to the project end.
- projectnumber: The project number or identifier as shown on the plans, if available.
- projectdate: The date of the project or the date shown on the plans, if available.
- notes: Any additional relevant information about the project limits or context found in the plans.

Instructions:
1. First, determine if the project limits describe a single street segment. If so, extract the names of the two closest cross streets at the start and end of the segment.
2. If the project is not a single street segment or the limits are unclear, omit the finish field and only provide the start field with any street name or intersection found.
3. Return only a valid JSON object with the fields described above. Do not include any explanation or extra text.
`;
    if (isPdfFile(file.name)) {
        // Upload PDF to Gemini File API and get file_uri
        const fileUri = await uploadPdfToGemini(file, aiKey);
        // Now call Gemini with file_uri
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(aiKey)}`;
        const body = {
            contents: [
                {
                    parts: [
                        { text: prompt_text },
                        { file_data: { mime_type: "application/pdf", file_uri: fileUri } }
                    ]
                }
            ]
        };
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        logStatus(`  DEBUG: Received API status: ${response.status} ${response.statusText}`);
        // --- Get response as raw text FIRST ---
        const responseBodyText = await response.text();
        logStatus(`  DEBUG: Raw API response body text: "${responseBodyText}"`);
        console.log("Raw API response body text:", responseBodyText); // log to console

        // --- NOW try to parse the raw text ---
        let data;
        try {
            data = JSON.parse(responseBodyText);
        } catch (parseError) {
            logStatus(`  Error: Failed to parse API response body as JSON.`);
            logStatus(`  Parse Error: ${parseError.message}`);
            // Throw a new error that includes the status and raw text
            throw new Error(`API response was not valid JSON. Status: ${response.status}. Body: ${responseBodyText}`);
        }

        // If parsing the response body succeeded, proceed ---
        logStatus("  DEBUG: Successfully parsed API response body.");
        console.log("Parsed API response data:", JSON.stringify(data, null, 2));
        logStatus("  DEBUG: Full API response logged to browser console.");
        // Check for API-level error
        if (data.error) {
            const errorMsg = `Gemini API returned an error: ${data.error.message || JSON.stringify(data.error)}`;
            logStatus(`  Error: ${errorMsg}`);
            throw new Error(errorMsg);
        }
        // Check for missing candidates
        if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
            const errorMsg = 'Gemini API response missing expected candidates structure.';
            logStatus(`  Error: ${errorMsg}`);
            logStatus(`  DEBUG: Received data: ${JSON.stringify(data)}`);
            throw new Error(errorMsg);
        }
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        if (text.startsWith("```")) {
            text = text.split("```", 2)[1] || text;
            if (text.trim().startsWith("json")) {
                text = text.trim().slice(4);
            }
            text = text.trim();
        }
        // Log the raw text before parsing
        console.log("Attempting to parse the following text as JSON:", text);
        logStatus(`  DEBUG: Raw text before JSON.parse: "${text}"`);
        try {
            return JSON.parse(text);
        } catch (e) {
            // Throw error with details for outer catch
            throw new Error(
                'AI response could not be parsed as JSON.' +
                '\nRaw AI response text: ' + text +
                '\nParse error: ' + (e && e.message ? e.message : e)
            );
        }
    } else {
        // Image: use base64 inline_data as before
        const base64Image = await fileToBase64(file);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${encodeURIComponent(aiKey)}`;
        const body = {
            contents: [
                {
                    parts: [
                        { text: prompt_text },
                        { inline_data: { mime_type: "image/jpeg", data: base64Image } }
                    ]
                }
            ]
        };
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        // Log full API response for debugging
        console.log("Full Gemini API response:", JSON.stringify(data, null, 2));
        logStatus("  DEBUG: Full API response logged to browser console.");
        // Check for API-level error
        if (data.error) {
            const errorMsg = `Gemini API returned an error: ${data.error.message || JSON.stringify(data.error)}`;
            logStatus(`  Error: ${errorMsg}`);
            throw new Error(errorMsg);
        }
        // Check for missing candidates
        if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
            const errorMsg = 'Gemini API response missing expected candidates structure.';
            logStatus(`  Error: ${errorMsg}`);
            logStatus(`  DEBUG: Received data: ${JSON.stringify(data)}`);
            throw new Error(errorMsg);
        }
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        if (text.startsWith("```")) {
            text = text.split("```", 2)[1] || text;
            if (text.trim().startsWith("json")) {
                text = text.trim().slice(4);
            }
            text = text.trim();
        }
        // Log the raw text before parsing
        console.log("Attempting to parse the following text as JSON:", text);
        logStatus(`  DEBUG: Raw text before JSON.parse: "${text}"`);
        try {
            return JSON.parse(text);
        } catch (e) {
            // Throw error with details for outer catch
            throw new Error(
                'AI response could not be parsed as JSON.' +
                '\nRaw AI response text: ' + text +
                '\nParse error: ' + (e && e.message ? e.message : e)
            );
        }
    }
}

async function geocodeAddressAGOL(address, token) {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&SingleLine=${encodeURIComponent(address)}&outFields=*&maxLocations=1&token=${encodeURIComponent(token)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.candidates && data.candidates.length > 0) {
        const loc = data.candidates[0].location;
        return { x: loc.x, y: loc.y };
    }
    return null;
}

// Buffer a point geometry by a given distance (meters, WGS84)
function bufferPointWGS84(x, y, meters) {
    // Approximate 1 deg latitude ~ 111320 meters, 1 deg longitude ~ 111320*cos(lat)
    const earthRadius = 6378137; // meters
    const dLat = (meters / earthRadius) * (180 / Math.PI);
    const dLon = dLat / Math.cos(y * Math.PI / 180);
    // Create a simple circle polygon (32 points)
    const points = [];
    for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * 2 * Math.PI;
        const px = x + dLon * Math.cos(angle);
        const py = y + dLat * Math.sin(angle);
        points.push([px, py]);
    }
    points.push(points[0]); // close the ring
    return {
        rings: [points],
        spatialReference: SPATIAL_REF
    };
}

// Buffer a line geometry by a given distance (meters, WGS84)
function bufferLineWGS84(start, finish, meters) {
    // We'll approximate by creating a buffer around the line segment (start, finish)
    // For simplicity, create a rectangle around the line, then buffer the endpoints as circles
    // This is a rough approximation for small distances
    const earthRadius = 6378137; // meters
    const dLat = (meters / earthRadius) * (180 / Math.PI);
    const avgLat = (start.y + finish.y) / 2;
    const dLon = dLat / Math.cos(avgLat * Math.PI / 180);
    // Calculate perpendicular offset vector
    const dx = finish.x - start.x;
    const dy = finish.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    let offsetX = 0, offsetY = 0;
    if (len > 0) {
        offsetX = -(dy / len) * dLon;
        offsetY = (dx / len) * dLat;
    }
    // Four corners of the rectangle
    const p1 = [start.x + offsetX, start.y + offsetY];
    const p2 = [finish.x + offsetX, finish.y + offsetY];
    const p3 = [finish.x - offsetX, finish.y - offsetY];
    const p4 = [start.x - offsetX, start.y - offsetY];
    // Approximate buffer as a polygon
    const ring = [p1, p2, p3, p4, p1];
    // Optionally, could add semicircles at ends for better accuracy
    return {
        rings: [ring],
        spatialReference: SPATIAL_REF
    };
}

async function addFeatureToLayer(attributes, geometry, token) {
    const adds = [{ attributes, geometry }];
    const url = `${FEATURE_LAYER_URL}/addFeatures`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `f=json&token=${encodeURIComponent(token)}&features=${encodeURIComponent(JSON.stringify(adds))}`
    });
    return await resp.json();
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
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const signOutBtn = document.getElementById('sign-out-btn');

function showSignOut(show) {
    signOutBtn.style.display = show ? '' : 'none';
}

// --- ArcGIS Online sign-in logic ---
const checkBtn = document.getElementById('check-credentials-btn');
const aiKeyInput = document.getElementById('ai-key-input');
const checkAIButton = document.getElementById('check-ai-btn');
const geocodeBtn = document.getElementById('geocode-btn');

// State tracking for enabling Geocode button
let aiKeyIsValid = false;
let agolIsSignedIn = false;
let fileIsUploaded = false;

function updateGeocodeBtnVisibility() {
    if (aiKeyIsValid && agolIsSignedIn && fileIsUploaded) {
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
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${encodeURIComponent(aiKey)}`;
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
    geocodeBtn.textContent = 'Working';
    geocodeBtn.disabled = true;
    processingLog.textContent = '';
    logStatus('--- Geocoding Process Started ---');

    // Find uploaded file(s) from fileInfo (UI) and process
    // We'll assume only one file for now (single image or zip)
    // You may want to adapt this for multiple files in a zip
    let fileList = [];
    // Try to get file name(s) from fileInfo
    const fileInfoList = fileInfo.querySelector('ul');
    if (fileInfoList) {
        fileList = Array.from(fileInfoList.querySelectorAll('li')).map(li => li.textContent);
    }
    if (fileList.length === 0) {
        logStatus('No files to process.');
        geocodeBtn.textContent = 'Complete';
        geocodeBtn.disabled = false;
        return;
    }

    // For each file, actually process and log each step
    // We'll assume the user uploaded a single image file (not zip) for now
    // You can expand this to handle zip/multiple files as needed
    const aiKey = aiKeyInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    let token = null;
    // Get AGOL token from IdentityManager if available
    if (window.require) {
        try {
            await new Promise((resolve, reject) => {
                window.require(["esri/identity/IdentityManager"], function(IdentityManager) {
                    const creds = IdentityManager.findCredential("https://www.arcgis.com/sharing/rest");
                    if (creds && creds.token) {
                        token = creds.token;
                        resolve();
                    } else {
                        reject("No AGOL token found");
                    }
                });
            });
        } catch (e) {
            logStatus('  Error: Could not get AGOL token.');
            geocodeBtn.textContent = 'Complete';
            geocodeBtn.disabled = false;
            return;
        }
    }
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
            let aiResult = null;
            try {
                aiResult = await analyzeFileWithGemini(fileObj, aiKey);
            } catch (e) {
                logStatus('  Error: Failed to analyze file with AI.');
                // Log the detailed error message including the raw response if available
                if (e && e.message) {
                    logStatus('  AI Error Details:\n' + e.message.replace(/\n/g, '\n  '));
                } else {
                    logStatus('  AI Error Details: ' + e); // Fallback
                }
                // Optional: log stack trace to console for deeper debugging
                console.error("AI Analysis Error Stack:", e);
                continue; // Skip to next file
            }
            // Extract fields from AI result
            const { start, finish, projectnumber, projectdate, notes } = aiResult;
            if (!start) {
                logStatus('  No start location found; skipping.');
                continue;
            }
            // Geocode start (and finish if present)
            logStatus('  Geocoding start...');
            let startLoc = null;
            try {
                startLoc = await geocodeAddressAGOL(start, token);
            } catch (e) {
                logStatus(`  Error: Geocoding failed for start: ${start}`);
                continue;
            }
            if (!startLoc) {
                logStatus(`  Geocode failed for start: ${start}`);
                continue;
            }
            let geometry = null;
            if (finish) {
                logStatus('  Geocoding finish...');
                let finishLoc = null;
                try {
                    finishLoc = await geocodeAddressAGOL(finish, token);
                } catch (e) {
                    logStatus(`  Error: Geocoding failed for finish: ${finish}`);
                    continue;
                }
                if (!finishLoc) {
                    logStatus(`  Geocode failed for finish: ${finish}`);
                    continue;
                }
                // Buffer the line between start and finish
                geometry = bufferLineWGS84(startLoc, finishLoc, 10);
            } else {
                // Buffer the start point
                geometry = bufferPointWGS84(startLoc.x, startLoc.y, 10);
            }
            // Prepare attributes for ArcGIS layer
            const attrs = {
                start: start || '',
                finish: finish || '',
                projectnumber: projectnumber || '',
                projectdate: projectdate || '',
                notes: notes || ''
            };
            // Add to feature layer
            logStatus('  Adding feature to layer...');
            let addResp = null;
            try {
                addResp = await addFeatureToLayer(attrs, geometry, token);
            } catch (e) {
                logStatus(`  Error: Failed to add feature for ${fname}`);
                continue;
            }
            if (addResp && addResp.addResults && addResp.addResults[0] && addResp.addResults[0].success) {
                logStatus(`  Added feature for ${fname}`);
            } else {
                logStatus(`  Error: Feature not added for ${fname}`);
            }
        } catch (e) {
            logStatus(`  Error processing ${fname}: ${e}`);
        }
    }
    logStatus('--- Geocoding Complete ---');
    geocodeBtn.textContent = 'Complete';
    geocodeBtn.disabled = false;
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
        if (file.size > MAX_FILE_SIZE) {
            fileInfo.innerHTML = '<p>File is too large. Maximum allowed size is 100MB.</p>';
            fileIsUploaded = false;
            updateGeocodeBtnVisibility();
            return;
        }
        if (file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')) {
            // Handle zip file
            handleZipFile(file);
        } else if (file.type.startsWith('image/') || isImageFile(file.name)) {
            // Single image file
            fileInfo.innerHTML = `<p>Received 1 image file:</p><ul><li>${file.name}</li></ul>`;
            window.lastDroppedFiles = [file];
            fileIsUploaded = true;
            updateGeocodeBtnVisibility();
        } else if (file.type === 'application/pdf' || isPdfFile(file.name)) {
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
            zip.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir && (isImageFile(zipEntry.name) || isPdfFile(zipEntry.name))) {
                    if (isImageFile(zipEntry.name)) imageFiles.push(zipEntry.name);
                    if (isPdfFile(zipEntry.name)) pdfFiles.push(zipEntry.name);
                    promises.push(zipEntry.async('blob').then(blob => {
                        // Create a File object if possible, else fallback to Blob with name
                        let f;
                        try {
                            f = new File([blob], zipEntry.name, { type: blob.type });
                        } catch {
                            f = blob;
                            f.name = zipEntry.name;
                        }
                        fileBlobs.push(f);
                    }));
                }
            });
            await Promise.all(promises);
            const totalFiles = imageFiles.length + pdfFiles.length;
            if (totalFiles > 0) {
                let summary = [];
                if (imageFiles.length > 0) summary.push(`${imageFiles.length} image file${imageFiles.length > 1 ? 's' : ''}`);
                if (pdfFiles.length > 0) summary.push(`${pdfFiles.length} PDF file${pdfFiles.length > 1 ? 's' : ''}`);
                fileInfo.innerHTML = `<p>Received ${summary.join(' and ')}:</p><ul>${[...imageFiles, ...pdfFiles].map(name => `<li>${name}</li>`).join('')}</ul>`;
                window.lastDroppedFiles = fileBlobs;
                fileIsUploaded = true;
            } else {
                fileInfo.innerHTML = '<p>No image or PDF files found in the zip.</p>';
                window.lastDroppedFiles = [];
                fileIsUploaded = false;
            }
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
