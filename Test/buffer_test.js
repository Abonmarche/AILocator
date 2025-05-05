// Test script for geodesicBufferOperator in ArcGIS Maps SDK for JavaScript
// This script creates a point and a line, buffers them, and outputs the area of the resulting buffers to the page.

// Test script for geodesicBufferOperator in ArcGIS Maps SDK for JavaScript
// This script creates a point and a line, buffers them, and outputs the area of the resulting buffers to the page.

window.runBufferTest = function(bufferDistance) {
  require([
    "esri/geometry/Point",
    "esri/geometry/Polyline",
    "esri/geometry/geometryEngine",
    "esri/geometry/SpatialReference",
    "esri/geometry/operators/geodesicBufferOperator"
  ], function(Point, Polyline, geometryEngine, SpatialReference, geodesicBufferOperator) {
    // Test data
    const point = new Point({
      x: -86.25, // longitude
      y: 41.68,  // latitude
      spatialReference: new SpatialReference({ wkid: 4326 })
    });
    const polyline = new Polyline({
      paths: [
        [
          [-86.25, 41.68],
          [-86.26, 41.69]
        ]
      ],
      spatialReference: new SpatialReference({ wkid: 4326 })
    });

    geodesicBufferOperator.load().then(function() {
      // Buffer the point
      const pointBuffer = geodesicBufferOperator.execute(point, bufferDistance, { unit: "meters" });
      const pointArea = geometryEngine.geodesicArea(pointBuffer, "square-meters");

      // Buffer the line
      const lineBuffer = geodesicBufferOperator.execute(polyline, bufferDistance, { unit: "meters" });
      const lineArea = geometryEngine.geodesicArea(lineBuffer, "square-meters");

      if (window.bufferTestOutput) {
        window.bufferTestOutput.innerHTML =
          `<b>Buffered Point Area (sq m):</b> ${pointArea.toLocaleString(undefined, {maximumFractionDigits: 2})}<br>` +
          `<b>Buffered Line Area (sq m):</b> ${lineArea.toLocaleString(undefined, {maximumFractionDigits: 2})}`;
      } else {
        console.log("Buffered Point Area (sq m):", pointArea);
        console.log("Buffered Line Area (sq m):", lineArea);
      }
    }).catch(function(err) {
      if (window.bufferTestOutput) {
        window.bufferTestOutput.textContent = 'Error: ' + (err && err.message ? err.message : err);
      } else {
        console.error("Error loading geodesicBufferOperator or buffering:", err);
      }
    });
  });
};
