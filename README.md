# AILocator

A web-based application that uses AI to analyze civil engineering project plans and automatically create geocoded project limits in ArcGIS Online feature layers.

## Overview

AILocator processes engineering plan documents (PDFs and images) to:
- Extract project information using Google's Gemini AI
- Identify project locations from plan text
- Geocode locations using ArcGIS geocoding services
- Create buffered geometries representing project limits
- Store results in ArcGIS Online feature layers with optional file attachments

## Features

- **AI-Powered Analysis**: Uses Gemini 2.5 Flash to analyze plans and extract project details
- **Multi-Format Support**: Handles individual images, PDFs, and ZIP archives
- **Smart Geocoding**: Identifies intersections, addresses, and road segments from plans
- **Flexible File Handling**: Three upload options for managing plan documents
- **ArcGIS Integration**: Direct integration with ArcGIS Online feature services

## Prerequisites

- Google Gemini API key
- ArcGIS Online account with appropriate permissions
- Feature layer with the following fields:
  - `projectname` (text)
  - `projectnumber` (text)
  - `projectdate` (text)
  - `notes` (text)
  - `parts_json` (text)
  - `Link` (text)

## How to Use

### 1. Initial Setup

1. Open `index.html` in a web browser
2. Enter your credentials:
   - **AI Key**: Your Google Gemini API key
   - **Username**: ArcGIS Online username
   - **Password**: ArcGIS Online password
   - **Location**: General project location (e.g., "Benton Harbor, MI 49022")
   - **Feature Layer URL**: Full URL to your feature layer including sublayer (e.g., `https://services.arcgis.com/.../FeatureServer/0`)

### 2. Select Upload Option

Choose how to handle plan files:

- **Option 1** (Default): Attach files under 10MB, upload larger files to AGOL
- **Option 2**: Upload all files to AGOL and add links
- **Option 3**: Only attach files under 10MB (skip larger files)

### 3. Upload Plans

Drag and drop one of the following:
- Single image file (JPG, PNG, etc.)
- Single PDF file
- ZIP archive containing multiple images/PDFs

**File Size Limits:**
- Individual files: 100MB max
- ZIP archives: 100MB max
- Attachments: 10MB max (for options 1 and 3)

### 4. Verify Credentials

1. Click **Check Credentials** to sign into ArcGIS Online
2. Click **Check AI** to verify your Gemini API key
3. Both buttons will turn green when successful

### 5. Geocode and Create Features

Once all requirements are met, the **Geocode** button will appear:
1. Click **Geocode** to start processing
2. The app will:
   - Analyze plans with AI to extract project information
   - Geocode identified locations
   - Create buffered geometries
   - Add feature to the specified layer
   - Handle file uploads based on selected option

### 6. Review Results

Monitor the Processing Log for:
- AI analysis results
- Geocoding attempts
- Feature creation status
- File upload progress
- Any errors or warnings

## Upload Options Explained

### Option 1: Hybrid Approach
- Files ≤10MB: Attached directly to the feature
- Files >10MB: Uploaded to AGOL, shared publicly, URL added to Link field
- Best for: Mixed file sizes, keeping small files with features

### Option 2: All Cloud
- All files uploaded to AGOL as content items
- Shared publicly and URLs added to Link field
- Best for: Consistent access method, large files

### Option 3: Attachments Only
- Only files ≤10MB are processed
- Files >10MB are skipped
- Best for: Keeping everything as feature attachments

## Technical Details

### AI Processing
- Uses Gemini 2.5 Flash for plan analysis
- PDFs <20MB use inline data (base64)
- PDFs ≥20MB use Gemini Files API
- Structured JSON output for consistent parsing

### Geocoding
- Supports single points and line segments
- Uses ArcGIS World Geocoding Service
- Creates 200-meter geodesic buffers around locations
- Handles multi-part projects

### File Storage
- Attachments use ArcGIS REST API `/addAttachment`
- AGOL uploads create content items with public sharing
- Link field stores comma-separated URLs for multiple files

## Troubleshooting

### Geocode Button Not Appearing
Ensure all four conditions are met:
1. File uploaded successfully
2. Credentials verified (green button)
3. AI key verified (green button)
4. Location field has text

### File Upload Errors
- Check file size limits
- Ensure proper file types (images or PDFs)
- Verify AGOL permissions for content creation

### AI Analysis Issues
- Large PDFs may take time to process
- Check API key validity
- Monitor processing log for specific errors

Requires internet connection for API access.