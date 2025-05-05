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

Your task is to decipher the project limits from the plan set and return a JSON object with the following fields, in this order:

- projectname: The name or title of the project as shown on the plans. This should be the main project name or title, if available. If not available, use the most descriptive name or title you can find.
- start: The best-identified starting location for the project. If the project is a street segment, this should be the intersection (e.g., "Main St and First St") closest to the project start. If the project is not a single street segment or the limits are unclear, provide any street name or intersection found in the plans that can be geocoded to approximate the project location.
- finish: (Optional) The best-identified ending location for the project. Only include this if the project is a single street segment and both start and end can be determined. This should be the intersection (e.g., "Main St and Second St") closest to the project end.
- projectnumber: The project number or identifier as shown on the plans, if available.
- projectdate: The date of the project or the date shown on the plans, if available. Always return the date in the numeric format MM/DD/YYYY (e.g., "05/01/2025"). If the day is missing, use "01" as the day (e.g., "05/01/2025"). If the month is missing, use "01" as the month (e.g., "01/01/2025"). If the year is missing, set the field to null.
- notes: Any additional relevant information about the project limits or context found in the plans.

Instructions:
1. First, determine if the project limits describe a single street segment. If so, extract the names of the two closest cross streets at the start and end of the segment.
2. If the project is not a single street segment or the limits are unclear, omit the finish field and only provide the start field with any street name or intersection found.
3. When identifying street names, note that street name labels on plans often run parallel to the street orientation. The closest label to a street is not always the name of that street. Instead, look at the orientation of the road and then look along that road for its label in the same orientation. Use this to accurately match street names to their corresponding roads.
4. Always return the projectdate in the numeric format MM/DD/YYYY (e.g., "05/01/2025"). If the day is missing, use "01" as the day (e.g., "05/01/2025"). If the month is missing, use "01" as the month (e.g., "01/01/2025"). If the year is missing, set the field to null.
5. Return only a valid JSON object with the fields described above, in the order listed. Do not include any explanation or extra text.

Format your response as a JSON object with these fields only, in the order above. Do not include any extra text, markdown, or explanation.`;

    let aiResponseText = '';
    if (isPdfFile(file.name)) {
        // For PDFs under 20MB, use inline_data (base64) as per REST docs
        if (file.size < 20 * 1024 * 1024) {
            const base64Pdf = await fileToBase64(file);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${encodeURIComponent(aiKey)}`;
            const body = {
                contents: [
                    {
                        parts: [
                            { inline_data: { mime_type: "application/pdf", data: base64Pdf } },
                            { text: prompt_text }
                        ]
                    }
                ]
            };
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            aiResponseText = await response.text();
        } else {
            // For large PDFs, use the File API (file_uri) with the newest model
            const fileUri = await uploadPdfToGemini(file, aiKey);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${encodeURIComponent(aiKey)}`;
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
            aiResponseText = await response.text();
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
    logStatus('--- AI File Analysis Started ---');

    // Find uploaded file(s) from fileInfo (UI) and process
    let fileList = [];
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

// here

            // --- Geocode start-&-finish, then buffer & area ----------------------------
            if (aiData && (aiData.start || aiData.finish)) {
                const locationDetails = locationDetailsInput ? locationDetailsInput.value.trim() : "";

                require(["esri/rest/locator"], function (locator) {
                    const locatorUrl = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

                    function geocodeAddress(address) {
                        if (!address) { return Promise.resolve(null); }
                        const full = locationDetails ? `${address}, ${locationDetails}` : address;

                        return locator.addressToLocations(
                            locatorUrl,
                            { address: { SingleLine: full }, outFields: ["*"], maxLocations: 1 }
                        )
                        .then(c => (c && c.length ? c[0].location : null))
                        .catch(err => {
                            logStatus(`  Geocode error for "${full}": ${err.message || err}`);
                            return null;
                        });
                    }

                    Promise.all([
                        geocodeAddress(aiData.start),
                        geocodeAddress(aiData.finish)
                    ]).then(function ([start, end]) {

                        if (start) logStatus(`  Start geocoded: (${start.x.toFixed(6)}, ${start.y.toFixed(6)})`);
                        if (end)   logStatus(`  End   geocoded: (${end.x.toFixed(6)}, ${end.y.toFixed(6)})`);

                        let geomType, arcgisGeom;
                        if (start && end) {
                            geomType   = "Line";
                            arcgisGeom = {
                                type: "polyline",
                                paths: [ [ [start.x, start.y], [end.x, end.y] ] ],
                                spatialReference: { wkid: 4326 }
                            };
                        } else if (start) {
                            geomType   = "Point";
                            arcgisGeom = {
                                type: "point",
                                x: start.x,
                                y: start.y,
                                spatialReference: { wkid: 4326 }
                            };
                        } else {
                            logStatus("  No valid geometry to buffer.");
                            return;
                        }

                        logStatus(`  Geometry to buffer: ${geomType}`);

// here

                        require([
                            "esri/geometry/Point",
                            "esri/geometry/Polyline",
                            "esri/geometry/SpatialReference",
                            "esri/geometry/geometryEngine",
                            "esri/geometry/operators/geodesicBufferOperator"
                        ], function (
                            Point,
                            Polyline,
                            SpatialReference,
                            geometryEngine,
                            geodesicBufferOperator
                        ) {
                            logStatus("  Loading geodesic buffer operator...");
                            
                            // Use Promise-based pattern matching your working test code
                            geodesicBufferOperator.load().then(function() {
                                try {
                                    logStatus("  Operator modules loaded.");

                                    const sr = new SpatialReference({ wkid: 4326 });
                                    let realGeom;
                                    
                                    if (geomType === "Point") {
                                        realGeom = new Point({
                                            x: arcgisGeom.x,
                                            y: arcgisGeom.y,
                                            spatialReference: sr
                                        });
                                    } else {
                                        realGeom = new Polyline({
                                            paths: arcgisGeom.paths,
                                            spatialReference: sr
                                        });
                                    }

                                    logStatus("  Buffering 10 m...");
                                    
                                    // Add the options parameter with unit: "meters"
                                    const buffered = geodesicBufferOperator.execute(realGeom, 10, { unit: "meters" });
                                    
                                    if (!buffered) {
                                        logStatus("  Buffer returned null.");
                                        return;
                                    }
                                    
                                    logStatus(`  ${geomType} buffered 10 m.`);

                                    const area = geometryEngine.geodesicArea(buffered, "square-meters");
                                    logStatus(`  Buffered area: ${area.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²`);

                                    // Add buffered geometry to hosted feature layer
                                    require(["esri/request"], function(esriRequest) {
                                        const featureLayerUrl = "https://services6.arcgis.com/o5a9nldztUcivksS/arcgis/rest/services/ProjectLimits/FeatureServer/0/addFeatures";
                                        // Prepare attributes from aiData
                                        const attributes = {
                                            start: aiData.start || null,
                                            finish: aiData.finish || null,
                                            projectnumber: aiData.projectnumber || null,
                                            projectdate: aiData.projectdate || null,
                                            notes: aiData.notes || null,
                                            projectname: aiData.projectname || null
                                        };
                                        // Convert geometry to ArcGIS JSON
                                        const geometryJson = buffered.toJSON ? buffered.toJSON() : buffered;
                                        const feature = {
                                            geometry: geometryJson,
                                            attributes: attributes
                                        };
                                        esriRequest(featureLayerUrl, {
                                            method: "post",
                                            query: {
                                                f: "json",
                                                features: JSON.stringify([feature])
                                            },
                                            responseType: "json"
                                        }).then(function(response) {
                                            if (response.data && response.data.addResults && response.data.addResults[0] && response.data.addResults[0].success) {
                                                logStatus("Project Added to Layer");
                                            } else {
                                                logStatus("  Error: Feature not added to layer.");
                                                if (response.data && response.data.addResults && response.data.addResults[0] && response.data.addResults[0].error) {
                                                    logStatus("  Layer Add Error: " + JSON.stringify(response.data.addResults[0].error));
                                                }
                                            }
                                        }).catch(function(err) {
                                            logStatus("  Error adding feature to layer: " + (err && err.message ? err.message : err));
                                            console.error("Layer Add Error:", err);
                                        });
                                    });
                                } catch (err) {
                                    logStatus(`  Buffer/area error: ${err.message || err}`);
                                    console.error("Buffer operation error:", err);
                                }
                            }).catch(function(err) {
                                logStatus(`  Error loading geodesic buffer operator: ${err.message || err}`);
                                console.error("Operator loading error:", err);
                            });
                        });
                    });
                });
            }
// here

        } catch (e) {
            logStatus(`  Error processing ${fname}: ${e}`);
        }
    }
    logStatus('--- AI File Analysis Complete ---');
    geocodeBtn.textContent = 'Complete';
    geocodeBtn.disabled = false;

    // Add one-time event listener to clear log and files on next click if button says Complete
    function handleCompleteClick() {
        if (geocodeBtn.textContent === 'Complete') {
            processingLog.textContent = '';
            fileInfo.innerHTML = '<p>Filename will appear here</p>';
            window.lastDroppedFiles = [];
            geocodeBtn.textContent = 'Geocode';
            geocodeBtn.removeEventListener('click', handleCompleteClick);
        }
    }
    geocodeBtn.addEventListener('click', handleCompleteClick);
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
