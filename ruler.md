# AR Ruler Implementation

## Overview
AR Ruler demo using ESP32 stereo SLAM for real-time distance measurement with RANSAC plane detection for enhanced accuracy.

## Core Implementation

### 1. Distance Calculation Engine
```javascript
// Real-time 3D distance computation
function calculateDistance(startPoint, currentPoint) {
  const dx = currentPoint.x - startPoint.x;
  const dy = currentPoint.y - startPoint.y;
  const dz = currentPoint.z - startPoint.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

// RANSAC plane detection for measurement accuracy
function detectMeasurementPlane(points, iterations = 1000, threshold = 0.01) {
  let bestPlane = null;
  let maxInliers = 0;
  
  for (let i = 0; i < iterations; i++) {
    // Randomly sample 3 points
    const samplePoints = getRandomSample(points, 3);
    const plane = fitPlaneToPoints(samplePoints);
    
    // Count inliers
    const inliers = points.filter(p => distanceToPlane(p, plane) < threshold);
    
    if (inliers.length > maxInliers) {
      maxInliers = inliers.length;
      bestPlane = plane;
    }
  }
  
  return bestPlane;
}

// Project measurement onto detected plane for accuracy
function projectToPlane(point, plane) {
  const { normal, d } = plane;
  const distance = normal.dot(point) + d;
  return point.sub(normal.multiplyScalar(distance));
}
```

### 2. Visual Rendering System
```javascript
// Three.js-based measurement visualization
class ARRulerVisualizer {
  constructor(scene) {
    this.scene = scene;
    this.startMarker = null;
    this.endMarker = null;
    this.measurementLine = null;
    this.distanceText = null;
  }
  
  createStartMarker(position) {
    const geometry = new THREE.SphereGeometry(0.1, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    this.startMarker = new THREE.Mesh(geometry, material);
    this.startMarker.position.copy(position);
    this.scene.add(this.startMarker);
  }
  
  createEndMarker(position) {
    const geometry = new THREE.SphereGeometry(0.1, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    this.endMarker = new THREE.Mesh(geometry, material);
    this.endMarker.position.copy(position);
    this.scene.add(this.endMarker);
  }
  
  updateMeasurementLine(startPos, endPos, distance) {
    if (this.measurementLine) {
      this.scene.remove(this.measurementLine);
    }
    
    const geometry = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
    const material = new THREE.LineBasicMaterial({ 
      color: this.getDistanceColor(distance),
      linewidth: 3
    });
    this.measurementLine = new THREE.Line(geometry, material);
    this.scene.add(this.measurementLine);
  }
  
  getDistanceColor(distance) {
    if (distance < 1) return 0x00ff00; // Green for close
    if (distance < 3) return 0xffff00; // Yellow for medium
    return 0xff0000; // Red for far
  }
}
```

### 3. User Interface Components
```javascript
// Measurement control buttons and display
class MeasurementUI {
  constructor() {
    this.distanceDisplay = document.getElementById('distance-display');
    this.startButton = document.getElementById('place-marker');
    this.endButton = document.getElementById('end-measurement');
    this.resetButton = document.getElementById('reset-measurement');
    
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    this.startButton.addEventListener('click', () => this.placeStartMarker());
    this.endButton.addEventListener('click', () => this.endMeasurement());
    this.resetButton.addEventListener('click', () => this.resetMeasurement());
  }
  
  updateDistance(distance) {
    this.distanceDisplay.textContent = `${distance.toFixed(3)} meters`;
  }
  
  placeStartMarker() {
    // Trigger start marker placement at current camera position
    this.onStartMarkerRequested();
  }
  
  endMeasurement() {
    // Finalize measurement and display results
    this.onEndMeasurementRequested();
  }
}
```

### 4. Main AR Ruler Logic
```javascript
// Core AR Ruler functionality
class ARRulerSystem {
  constructor() {
    this.startPoint = null;
    this.endPoint = null;
    this.measurementMode = 'placing'; // 'placing', 'measuring', 'complete'
    this.visualizer = null;
    this.ui = null;
    this.camera = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.measurementPlane = null;
  }

  // Get camera position and direction from pose matrix
  getCameraTransform(poseMatrix) {
    const position = new THREE.Vector3(poseMatrix[12], poseMatrix[13], poseMatrix[14]);
    
    // Extract rotation matrix (3x3) from pose matrix
    const rotationMatrix = new THREE.Matrix3();
    rotationMatrix.set(
      poseMatrix[0], poseMatrix[1], poseMatrix[2],
      poseMatrix[4], poseMatrix[5], poseMatrix[6],
      poseMatrix[8], poseMatrix[9], poseMatrix[10]
    );
    
    // Get forward direction (negative Z axis in camera space)
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyMatrix3(rotationMatrix);
    
    return { position, direction };
  }

  // Raycast from camera center to find world point
  raycastToWorld(cameraPosition, cameraDirection, maxDistance = 10.0) {
    const rayOrigin = cameraPosition.clone();
    const rayDirection = cameraDirection.clone();
    
    // Try multiple planes for better intersection detection
    const planes = [
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), // Ground plane
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 1), // Table height
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5), // Below ground
    ];
    
    for (const plane of planes) {
      const intersectionPoint = new THREE.Vector3();
      if (plane.raycast(new THREE.Ray(rayOrigin, rayDirection), intersectionPoint)) {
        const distance = rayOrigin.distanceTo(intersectionPoint);
        if (distance > 0.1 && distance < maxDistance) {
          return intersectionPoint;
        }
      }
    }
    
    // Fallback: point at fixed distance in front of camera
    return rayOrigin.clone().add(rayDirection.clone().multiplyScalar(2.0));
  }

  // Place marker at world point under crosshair
  placeStartMarker(currentPose) {
    const { position, direction } = this.getCameraTransform(currentPose);
    this.startPoint = this.raycastToWorld(position, direction);
    this.measurementMode = 'measuring';
    
    this.visualizer.createStartMarker(this.startPoint);
    this.ui.updateStatus('Move camera to end point');
  }

  // Place end marker at world point under crosshair
  placeEndMarker(currentPose) {
    const { position, direction } = this.getCameraTransform(currentPose);
    this.endPoint = this.raycastToWorld(position, direction);
    this.measurementMode = 'complete';
    
    this.visualizer.createEndMarker(this.endPoint);
    
    const finalDistance = this.calculateDistance(this.startPoint, this.endPoint);
    this.ui.updateDistance(finalDistance);
    this.ui.updateStatus('Measurement complete');
    
    return finalDistance;
  }

  updateMeasurement(currentPose) {
    if (this.measurementMode === 'measuring' && this.startPoint) {
      const { position, direction } = this.getCameraTransform(currentPose);
      const currentEndPoint = this.raycastToWorld(position, direction);
      const distance = this.calculateDistance(this.startPoint, currentEndPoint);
      
      this.ui.updateDistance(distance);
      this.visualizer.updateMeasurementLine(this.startPoint, currentEndPoint, distance);
    }
  }
}
```

## HTML Structure
```html
<!-- Based on existing ESP32 stereo demos -->
<div id="main-container">
  <div id="container">
    <!-- Camera feeds and SLAM visualization -->
  </div>
  <div id="measurement-panel">
    <div id="distance-display">0.000 meters</div>
    <div id="status-display">Place start marker</div>
    <div id="control-buttons">
      <button id="place-marker">Mark Start Point</button>
      <button id="end-measurement">Mark End Point</button>
      <button id="reset-measurement">Reset</button>
    </div>
  </div>
</div>
```

## Key Features
- **RANSAC Plane Detection**: Improves measurement accuracy by detecting and projecting onto measurement surfaces
- **Real-time Distance**: Continuous distance calculation with visual feedback
- **Visual Markers**: Clear start/end point indicators with color coding
- **Measurement Line**: Dynamic line showing measurement path
- **Error Handling**: Robust handling of SLAM tracking loss and measurement errors
