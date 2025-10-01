// Import THREE.js for 3D math operations
import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/build/three.module.js';

// Centralized monocular scale factor for AR ruler measurements
// V1-01 Easy dataset has 2.73x larger baseline (52.404 vs 19.202267 pixels)
// This means stereo triangulation is more accurate, so scale factor should be adjusted
export const MONOCULAR_SCALE_FACTOR = 1; // Baseline ratio: 52.404/19.202267 ≈ 2.73
// Note: Scale factor may need adjustment based on actual performance testing

export async function waitForEmscriptenModule(ModuleInstance) {
  return new Promise(resolve => {
    if (ModuleInstance && ModuleInstance.calledRun) {
      resolve();
    } else if (ModuleInstance && typeof ModuleInstance.onRuntimeInitialized === 'function') {
      ModuleInstance.onRuntimeInitialized = resolve;
    } else {
      const check = setInterval(() => {
        if (ModuleInstance && ModuleInstance.calledRun) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    }
  });
}

// Parse calibration YAML to extract left camera intrinsics
export function parseCalibrationYAML(yamlText) {
  const lines = yamlText.split('\n');
  let kMatrixData = null;
  let inKMatrix = false;
  let dataLine = '';
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Look for LEFT.K matrix
    if (trimmedLine === 'LEFT.K: !!opencv-matrix') {
      inKMatrix = true;
      continue;
    }
    
    // If we're in the K matrix section, look for data
    if (inKMatrix) {
      if (trimmedLine.startsWith('data: [')) {
        dataLine = trimmedLine;
        break;
      }
    }
  }
  
  if (dataLine) {
    // Extract the data array from the line
    // Format: "data: [385.004, 0.0, 325.346, 0.0, 385.004, 238.491, 0.0, 0.0, 1.0]"
    const dataMatch = dataLine.match(/data:\s*\[(.*?)\]/);
    if (dataMatch) {
      const dataString = dataMatch[1];
      const values = dataString.split(',').map(v => parseFloat(v.trim()));
      
      if (values.length >= 9) {
        // OpenCV 3x3 matrix format: [fx, 0, cx, 0, fy, cy, 0, 0, 1]
        return {
          fx: values[0],  // 385.004
          fy: values[4],  // 385.004
          cx: values[2],  // 325.346
          cy: values[5]   // 238.491
        };
      }
    }
  }
  
  throw new Error('Could not parse LEFT.K matrix from YAML');
}

// Draw plane outline on 2D frame
export function drawPlaneOutlineOnFrame(ctx, plane, pose, cameraIntrinsics) {
  if (!plane || !pose || !cameraIntrinsics) return;
  
  // Get camera intrinsics
  const fx = cameraIntrinsics.fx;
  const fy = cameraIntrinsics.fy;
  const cx = cameraIntrinsics.cx;
  const cy = cameraIntrinsics.cy;
  
  // Get camera position and direction from pose
  const cameraPosition = new THREE.Vector3(pose[12], -pose[13], -pose[14]);
  const rotationMatrix = new THREE.Matrix4().fromArray(pose);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
  quaternion.set(-quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  
  // Create a grid of points on the plane to project to 2D
  const planeSize = 0.25; // 25cm x 25cm plane (0.25m = 25cm)
  const gridResolution = 20; // 20x20 grid points
  const gridPoints = [];
  
  // Create two orthogonal vectors on the plane
  const planeNormal = plane.normal.clone();
  const planePoint = plane.point.clone();
  
  // Find two orthogonal vectors on the plane
  let u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(planeNormal.dot(u)) > 0.9) {
    u = new THREE.Vector3(0, 1, 0);
  }
  u = u.clone().sub(planeNormal.clone().multiplyScalar(planeNormal.dot(u))).normalize();
  const v = planeNormal.clone().cross(u).normalize();
  
  // Generate grid points on the plane
  for (let i = 0; i <= gridResolution; i++) {
    for (let j = 0; j <= gridResolution; j++) {
      const uOffset = (i / gridResolution - 0.5) * planeSize;
      const vOffset = (j / gridResolution - 0.5) * planeSize;
      
      const gridPoint = planePoint.clone()
        .add(u.clone().multiplyScalar(uOffset))
        .add(v.clone().multiplyScalar(vOffset));
      
      gridPoints.push(gridPoint);
    }
  }
  
  // Project grid points to 2D and draw lines
  const projectedPoints = [];
  
  for (const point3D of gridPoints) {
    // Transform to camera coordinate system
    const cameraPoint = point3D.clone().sub(cameraPosition);
    const rotatedPoint = cameraPoint.clone().applyQuaternion(quaternion);
    
    // Project to 2D
    if (rotatedPoint.z > 0.1) { // Only points in front of camera
      const x = (rotatedPoint.x * fx / rotatedPoint.z) + cx;
      const y = (rotatedPoint.y * fy / rotatedPoint.z) + cy;
      
      // Only include points within image bounds
      if (x >= 0 && x < 640 && y >= 0 && y < 480) {
        projectedPoints.push({x, y, z: rotatedPoint.z});
      }
    }
  }
  
  if (projectedPoints.length < 4) return; // Need at least 4 points to draw a plane
  
  // Draw horizontal grid lines
  ctx.strokeStyle = 'rgba(0, 255, 0, 0.6)'; // Green with transparency
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  for (let i = 0; i <= gridResolution; i++) {
    const rowPoints = [];
    for (let j = 0; j <= gridResolution; j++) {
      const idx = i * (gridResolution + 1) + j;
      if (idx < projectedPoints.length) {
        rowPoints.push(projectedPoints[idx]);
      }
    }
    
    if (rowPoints.length > 1) {
      // Sort by x coordinate for smooth line
      rowPoints.sort((a, b) => a.x - b.x);
      
      ctx.moveTo(rowPoints[0].x, rowPoints[0].y);
      for (let k = 1; k < rowPoints.length; k++) {
        ctx.lineTo(rowPoints[k].x, rowPoints[k].y);
      }
    }
  }
  
  // Draw vertical grid lines
  for (let j = 0; j <= gridResolution; j++) {
    const colPoints = [];
    for (let i = 0; i <= gridResolution; i++) {
      const idx = i * (gridResolution + 1) + j;
      if (idx < projectedPoints.length) {
        colPoints.push(projectedPoints[idx]);
      }
    }
    
    if (colPoints.length > 1) {
      // Sort by y coordinate for smooth line
      colPoints.sort((a, b) => a.y - b.y);
      
      ctx.moveTo(colPoints[0].x, colPoints[0].y);
      for (let k = 1; k < colPoints.length; k++) {
        ctx.lineTo(colPoints[k].x, colPoints[k].y);
      }
    }
  }
  
  ctx.stroke();
  
  // Draw plane center point
  const centerPoint = planePoint.clone();
  const cameraCenterPoint = centerPoint.clone().sub(cameraPosition);
  const rotatedCenterPoint = cameraCenterPoint.clone().applyQuaternion(quaternion);
  
  if (rotatedCenterPoint.z > 0.1) {
    const centerX = (rotatedCenterPoint.x * fx / rotatedCenterPoint.z) + cx;
    const centerY = (rotatedCenterPoint.y * fy / rotatedCenterPoint.z) + cy;
    
    if (centerX >= 0 && centerX < 640 && centerY >= 0 && centerY < 480) {
      ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

// AR Ruler Measurement System
export class ARRulerSystem {
  constructor() {
    this.startPoint = null;
    this.endPoint = null;
    this.measurementMode = 'placing'; // 'placing', 'measuring', 'complete'
    this.visualizer = null;
    this.ui = null;
    this.camera = null;
    this.alva = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.measurementPlane = null;
    
    // Plane detection properties
    this.detectedPlane = null;
    this.planePoints = [];
    this.usePlaneMode = false;
  }

  initialize(visualizer, ui, camera, alva) {
    this.visualizer = visualizer;
    this.ui = ui;
    this.camera = camera;
    this.alva = alva;
  }

  // RANSAC-based plane detection from 3D points
  detectPlaneRANSAC(points3D, maxIterations = 1000, distanceThreshold = 0.05, minInliers = 50) {
    if (!points3D || points3D.length < 3) {
      return null;
    }

    let bestPlane = null;
    let bestInliers = [];
    let maxInlierCount = 0;

    // Apply coordinate transformation to match the system
    const monocularScaleFactor = MONOCULAR_SCALE_FACTOR;
    const transformedPoints = points3D.map(point3D => new THREE.Vector3(
      point3D.x * monocularScaleFactor,
      -point3D.y * monocularScaleFactor,
      -point3D.z * monocularScaleFactor
    ));

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Randomly select 3 points to define a plane
      const indices = [];
      while (indices.length < 3) {
        const idx = Math.floor(Math.random() * transformedPoints.length);
        if (!indices.includes(idx)) {
          indices.push(idx);
        }
      }

      const p1 = transformedPoints[indices[0]];
      const p2 = transformedPoints[indices[1]];
      const p3 = transformedPoints[indices[2]];

      // Calculate plane equation: ax + by + cz + d = 0
      const v1 = p2.clone().sub(p1);
      const v2 = p3.clone().sub(p1);
      const normal = v1.clone().cross(v2).normalize();
      const d = -normal.dot(p1);

      // Count inliers (points close to the plane)
      const inliers = [];
      for (let i = 0; i < transformedPoints.length; i++) {
        const point = transformedPoints[i];
        const distance = Math.abs(normal.dot(point) + d);
        if (distance < distanceThreshold) {
          inliers.push(i);
        }
      }

      // Update best plane if this one has more inliers
      if (inliers.length > maxInlierCount && inliers.length >= minInliers) {
        maxInlierCount = inliers.length;
        bestInliers = inliers;
        bestPlane = {
          normal: normal,
          d: d,
          point: p1.clone(), // A point on the plane
          inliers: inliers.length
        };
      }
    }

    if (bestPlane) {
      console.log(`Plane detected with ${bestPlane.inliers} inliers out of ${transformedPoints.length} points`);
      return bestPlane;
    }

    return null;
  }

  // RANSAC plane detection with raycast constraint
  detectPlaneRANSACWithConstraint(points3D, constraintPoint, maxIterations = 1000, distanceThreshold = 0.05, minInliers = 20) {
    if (!points3D || points3D.length < 3) {
      return null;
    }

    const monocularScaleFactor = MONOCULAR_SCALE_FACTOR;
    const transformedPoints = points3D.map(point3D => new THREE.Vector3(
      point3D.x * monocularScaleFactor,
      -point3D.y * monocularScaleFactor,
      -point3D.z * monocularScaleFactor
    ));

    let bestPlane = null;
    let bestInlierCount = 0;

    for (let i = 0; i < maxIterations; i++) {
      // Randomly select 3 points, but ensure one is close to the constraint point
      let p1, p2, p3;
      
      // First, find a point close to the constraint point
      let closestToConstraint = 0;
      let minDistanceToConstraint = Infinity;
      
      for (let j = 0; j < transformedPoints.length; j++) {
        const distance = transformedPoints[j].distanceTo(constraintPoint);
        if (distance < minDistanceToConstraint) {
          minDistanceToConstraint = distance;
          closestToConstraint = j;
        }
      }
      
      p1 = transformedPoints[closestToConstraint];
      
      // Select two other random points
      const remainingIndices = transformedPoints.map((_, idx) => idx).filter(idx => idx !== closestToConstraint);
      const randomIdx2 = Math.floor(Math.random() * remainingIndices.length);
      const randomIdx3 = Math.floor(Math.random() * remainingIndices.length);
      
      if (randomIdx2 === randomIdx3) continue;
      
      p2 = transformedPoints[remainingIndices[randomIdx2]];
      p3 = transformedPoints[remainingIndices[randomIdx3]];

      // Calculate plane from 3 points
      const v1 = new THREE.Vector3().subVectors(p2, p1);
      const v2 = new THREE.Vector3().subVectors(p3, p1);
      const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

      if (normal.length() < 0.1) continue; // Skip if points are collinear

      // Calculate plane equation: normal.dot(point) + d = 0
      const d = -normal.dot(p1);

      // Count inliers (points close to the plane)
      const inliers = [];
      for (const point of transformedPoints) {
        const distance = Math.abs(normal.dot(point) + d);
        if (distance < distanceThreshold) {
          inliers.push(point);
        }
      }

      // Check if this is the best plane so far
      if (inliers.length >= minInliers && inliers.length > bestInlierCount) {
        bestInlierCount = inliers.length;
        bestPlane = {
          normal: normal,
          point: p1,
          d: d,
          inliers: inliers
        };
      }
    }

    if (bestPlane) {
      console.log(`Plane detected with ${bestPlane.inliers.length} inliers out of ${transformedPoints.length} points (including raycast constraint)`);
      return bestPlane;
    }

    return null;
  }

  // Manually draw a new plane based on current keyframe points
  drawNewPlane() {
    console.log('=== PLANE DETECTION DEBUG ===');
    
    if (!this.alva || !this.alva.getFramePoints3D) {
      console.log('❌ Cannot draw plane - no 3D points available (alva or getFramePoints3D not found)');
      return false;
    }

    const points3D = this.alva.getFramePoints3D();
    console.log('📊 Total 3D points available:', points3D ? points3D.length : 'null');
    
    if (!points3D || points3D.length < 20) {
      console.log('❌ Cannot draw plane - insufficient 3D points (need at least 20, got ' + (points3D ? points3D.length : 0) + ')');
      return false;
    }

    // Get camera pose for raycast constraint
    const cameraPosition = this.camera.position;
    const cameraDirection = new THREE.Vector3(0, 0, -1);
    cameraDirection.applyQuaternion(this.camera.quaternion);
    
    console.log(`📷 Camera position: (${cameraPosition.x.toFixed(3)}, ${cameraPosition.y.toFixed(3)}, ${cameraPosition.z.toFixed(3)})`);
    console.log(`📷 Camera direction: (${cameraDirection.x.toFixed(3)}, ${cameraDirection.y.toFixed(3)}, ${cameraDirection.z.toFixed(3)})`);

    // Find the nearest 3D point to the raycast line (this will be our constraint point)
    let raycastPoint = null;
    let bestDistance = Infinity;
    
    const monocularScaleFactor = MONOCULAR_SCALE_FACTOR;
    for (const point of points3D) {
      const transformedPoint = new THREE.Vector3(
        point.x * monocularScaleFactor,
        -point.y * monocularScaleFactor,
        -point.z * monocularScaleFactor
      );
      const distance = this.distancePointToRay(cameraPosition, cameraDirection, transformedPoint);
      
      if (distance < bestDistance) {
        bestDistance = distance;
        raycastPoint = transformedPoint;
      }
    }
    
    if (!raycastPoint) {
      console.log('❌ Could not find raycast intersection point');
      return false;
    }
    
    console.log(`🎯 Raycast constraint point: (${raycastPoint.x.toFixed(3)}, ${raycastPoint.y.toFixed(3)}, ${raycastPoint.z.toFixed(3)})`);
    console.log(`📏 Distance to ray: ${bestDistance.toFixed(3)}m`);

    // Analyze point distribution
    if (points3D.length > 0) {
      const monocularScaleFactor = MONOCULAR_SCALE_FACTOR;
      const transformedPoints = points3D.map(point3D => new THREE.Vector3(
        point3D.x * monocularScaleFactor,
        -point3D.y * monocularScaleFactor,
        -point3D.z * monocularScaleFactor
      ));
      
      // Calculate point statistics
      const xCoords = transformedPoints.map(p => p.x);
      const yCoords = transformedPoints.map(p => p.y);
      const zCoords = transformedPoints.map(p => p.z);
      
      const xRange = Math.max(...xCoords) - Math.min(...xCoords);
      const yRange = Math.max(...yCoords) - Math.min(...yCoords);
      const zRange = Math.max(...zCoords) - Math.min(...zCoords);
      
      console.log('📈 Point distribution:');
      console.log('   X range:', xRange.toFixed(2), 'm');
      console.log('   Y range:', yRange.toFixed(2), 'm');
      console.log('   Z range:', zRange.toFixed(2), 'm');
      console.log('   Points span:', Math.sqrt(xRange*xRange + yRange*yRange + zRange*zRange).toFixed(2), 'm');
      
      // Check if points are too close together (might indicate poor detection)
      if (xRange < 0.5 && yRange < 0.5 && zRange < 0.5) {
        console.log('⚠️  Warning: Points are very close together, plane detection may be unreliable');
      }
    }

    // Clear existing plane visualization and state
    this.detectedPlane = null;
    this.usePlaneMode = false;
    this.planePoints = [];
    
    if (this.visualizer) {
      this.visualizer.clearPlaneVisualization();
    }

    // Try multiple RANSAC configurations
    const configs = [
      { maxIterations: 1000, distanceThreshold: 0.05, minInliers: 20 }, // Original
      { maxIterations: 2000, distanceThreshold: 0.1, minInliers: 15 },  // More lenient
      { maxIterations: 5000, distanceThreshold: 0.2, minInliers: 10 },  // Very lenient
      { maxIterations: 1000, distanceThreshold: 0.03, minInliers: 25 }  // Stricter
    ];
    
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      console.log(`🔄 Trying RANSAC config ${i+1}: threshold=${config.distanceThreshold}, minInliers=${config.minInliers}`);
      
      const detectedPlane = this.detectPlaneRANSACWithConstraint(points3D, raycastPoint, config.maxIterations, config.distanceThreshold, config.minInliers);
      if (detectedPlane) {
        this.detectedPlane = detectedPlane;
        this.usePlaneMode = true; // Enable plane mode for marker placement
        
        // Visualize the detected plane
        if (this.visualizer) {
          this.visualizer.createPlaneVisualization(detectedPlane);
        }
        
        console.log('✅ New plane drawn with ' + detectedPlane.inliers.length + ' inliers using config ' + (i+1));
        console.log(`🎯 Plane passes through raycast point: (${raycastPoint.x.toFixed(3)}, ${raycastPoint.y.toFixed(3)}, ${raycastPoint.z.toFixed(3)})`);
        console.log('📐 Plane normal:', detectedPlane.normal);
        console.log('📍 Plane point:', detectedPlane.point);
        return true;
      } else {
        console.log(`❌ Config ${i+1} failed to detect plane`);
      }
    }
    
    console.log('❌ All RANSAC configurations failed to detect a plane');
    console.log('💡 Suggestions:');
    console.log('   - Point camera at a flat surface (floor, wall, table)');
    console.log('   - Ensure good lighting and texture on the surface');
    console.log('   - Move camera closer to the surface');
    console.log('   - Wait for more 3D points to be detected');
    return false;
  }

  // Clear the current plane
  clearPlane() {
    console.log('🗑️ Clearing current plane...');
    
    // Reset plane state
    this.detectedPlane = null;
    this.usePlaneMode = false;
    this.planePoints = [];
    
    // Clear visualization
    if (this.visualizer) {
      this.visualizer.clearPlaneVisualization();
    }
    
    console.log('✅ Plane cleared - markers will be placed on nearest 3D points');
  }

  // Calculate distance from a point to a ray
  distancePointToRay(rayOrigin, rayDirection, point) {
    const toPoint = new THREE.Vector3().subVectors(point, rayOrigin);
    const projectionLength = toPoint.dot(rayDirection);
    const projection = new THREE.Vector3().copy(rayDirection).multiplyScalar(projectionLength);
    const perpendicular = new THREE.Vector3().subVectors(toPoint, projection);
    return perpendicular.length();
  }

  // Intersect ray with plane
  intersectRayWithPlane(rayOrigin, rayDirection, plane) {
    // Plane equation: normal.dot(point) + d = 0
    // Ray equation: point = rayOrigin + t * rayDirection
    // Substitute: normal.dot(rayOrigin + t * rayDirection) + d = 0
    // Solve for t: t = -(normal.dot(rayOrigin) + d) / normal.dot(rayDirection)
    
    const denominator = plane.normal.dot(rayDirection);
    
    // Check if ray is parallel to plane
    if (Math.abs(denominator) < 1e-6) {
      return null; // Ray is parallel to plane
    }
    
    const numerator = -(plane.normal.dot(rayOrigin) + plane.d);
    const t = numerator / denominator;
    
    // Check if intersection is in front of camera
    if (t <= 0.1) {
      return null; // Intersection is behind camera
    }
    
    // Calculate intersection point
    const intersectionPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(t));
    
    return intersectionPoint;
  }

  calculateDistance(startPoint, endPoint) {
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const dz = endPoint.z - startPoint.z;
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    // MONOCULAR SCALE: The measurements are already in monocular scale
    // No additional scaling needed since we're using monocular pose directly
    return distance;
  }

  // Get camera position and direction from pose matrix
  getCameraTransform(poseMatrix) {
    // Apply AlvaAR coordinate transform for consistency with stereo visualizer
    // This matches the transformation in AlvaARConnectorTHREE: (x, -y, -z) for position
    // MONOCULAR POSE: Use position directly (no scaling needed)
    const position = new THREE.Vector3(poseMatrix[12], -poseMatrix[13], -poseMatrix[14]);
    
    // Extract rotation matrix and apply AlvaARConnectorTHREE transformation
    const rotationMatrix = new THREE.Matrix4().fromArray(poseMatrix);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
    // Apply AlvaARConnectorTHREE rotation transformation: (-x, y, z, w)
    quaternion.set(-quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    
    // Get forward direction (negative Z axis in camera space)
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(quaternion);
    
    return { position, direction };
  }

  // Calculate distance to nearest environment point along the crosshair direction
  calculateNearestDistance(cameraPosition, cameraDirection, maxDistance = 1.0) {
    // Create a ray from camera position in camera direction
    const rayOrigin = cameraPosition.clone();
    const rayDirection = cameraDirection.clone();
    
    // If plane mode is enabled and we have a detected plane, intersect with plane
    if (this.usePlaneMode && this.detectedPlane) {
      const planeIntersection = this.intersectRayWithPlane(rayOrigin, rayDirection, this.detectedPlane);
      if (planeIntersection) {
        return cameraPosition.distanceTo(planeIntersection);
      }
    }
    
    // Fallback to 3D point raycasting
    // Get 3D frame points from SLAM system
    if (!this.alva || !this.alva.getFramePoints3D) {
      console.log('No alva or getFramePoints3D available');
      return 2.0;
    }
    
    const points3D = this.alva.getFramePoints3D();
    //console.log('Available 3D points:', points3D ? points3D.length : 'null');
    
    if (!points3D || points3D.length === 0) {
      console.log('No 3D points available');
      return 2.0;
    }
    
    let nearestDistance = Infinity;
    
    // Find the nearest 3D point along the raycasted center direction
    for (const point3D of points3D) {
      // Apply the same coordinate transformation as used for feature points
      const monocularScaleFactor = MONOCULAR_SCALE_FACTOR;
      const transformedPoint = new THREE.Vector3(
        point3D.x * monocularScaleFactor, 
        -point3D.y * monocularScaleFactor, 
        -point3D.z * monocularScaleFactor
      );
      
      // Calculate distance from camera to this point
      const distanceFromCamera = transformedPoint.distanceTo(rayOrigin);
      
      // Only consider points in front of the camera and within max distance
      const pointToRayOrigin = transformedPoint.clone().sub(rayOrigin);
      const projectionLength = pointToRayOrigin.dot(rayDirection);
      
      // Check if point is in front of camera and within max distance
      if (projectionLength > 0.1 && distanceFromCamera < maxDistance) {
        // Calculate the perpendicular distance from the point to the ray line
        // This gives us how close the point is to the raycasted center direction
        const closestPointOnRay = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(projectionLength));
        const perpendicularDistance = transformedPoint.distanceTo(closestPointOnRay);
        
        // Only consider points that are close to the ray line (within tolerance)
        const rayTolerance = 0.05; // 5cm tolerance for ray alignment
        if (perpendicularDistance < rayTolerance) {
          // This point is along the raycasted center direction, check if it's the nearest
          if (distanceFromCamera < nearestDistance) {
            nearestDistance = distanceFromCamera;
            //console.log('Found point along raycasted center:', distanceFromCamera, 'perpendicular:', perpendicularDistance);
          }
        }
      }
    }
    
    // Return the nearest distance if found, otherwise fallback
    if (nearestDistance !== Infinity) {
      //console.log('Found nearest distance:', nearestDistance);
      return nearestDistance;
    }
    
    // Fallback: return fixed distance
    console.log('No suitable points found, using fallback distance');
    return 2.0;
  }

  // Raycast from camera center to find nearest 3D frame point within 10cm tolerance
  raycastToWorld(cameraPosition, cameraDirection, maxDistance = 10.0, markerDistanceForward = 0.5) {
    // Use the same distance calculation as the UI display
    const nearestDistance = this.calculateNearestDistance(cameraPosition, cameraDirection, maxDistance);
    
    // Create a ray from camera position in camera direction
    const rayOrigin = cameraPosition.clone();
    const rayDirection = cameraDirection.clone();
    
    // Place the marker at the raycasted point, then move it further along the ray by the specified distance
    const raycastPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(nearestDistance));
    const markerPosition = raycastPoint.clone().add(rayDirection.clone().multiplyScalar(markerDistanceForward));
    
    if (window.debugCounter % 30 === 0) {
      console.log('Raycast point:', raycastPoint, 'distance:', nearestDistance.toFixed(3));
      console.log('Marker position (forward by', markerDistanceForward.toFixed(1), 'm):', markerPosition);
    }
    
    return markerPosition;
  }

  // Place marker at world point under crosshair
  placeStartMarker(currentPose) {
    const { position, direction } = this.getCameraTransform(currentPose);
        const markerDistance = this.ui ? this.ui.getMarkerDistance() : 0.0;
    this.startPoint = this.raycastToWorld(position, direction, 10.0, markerDistance);
    this.measurementMode = 'measuring';
    
    // Debug logging (reduced frequency to prevent memory leaks)
    if (window.debugCounter % 30 === 0) {
      console.log('Camera position:', position);
      console.log('Camera direction:', direction);
      console.log('Marker distance forward from raycast:', markerDistance);
      console.log('Start marker placed at:', this.startPoint);
    }
    
    if (this.visualizer) {
      this.visualizer.createStartMarker(this.startPoint);
    }
    
    if (this.ui) {
      this.ui.updateStatus('Move camera to end point');
    }
  }

  // Place end marker at world point under crosshair
  placeEndMarker(currentPose) {
    const { position, direction } = this.getCameraTransform(currentPose);
        const markerDistance = this.ui ? this.ui.getMarkerDistance() : 0.0;
    this.endPoint = this.raycastToWorld(position, direction, 10.0, markerDistance);
    this.measurementMode = 'complete';
    
    if (this.visualizer) {
      this.visualizer.createEndMarker(this.endPoint);
      // Update measurement line when end marker is placed/moved
      if (this.startPoint) {
        const distance = this.calculateDistance(this.startPoint, this.endPoint);
        this.visualizer.updateMeasurementLine(this.startPoint, this.endPoint, distance);
      }
    }
    
    const finalDistance = this.calculateDistance(this.startPoint, this.endPoint)/MONOCULAR_SCALE_FACTOR; //divide by scale factor to get reverse scaled distance
    
    if (this.ui) {
      this.ui.updateDistance(finalDistance); //finalDistance already divided by scale factor
      this.ui.updateStatus('Measurement complete');
    }
    
    if (window.debugCounter % 30 === 0) {
      console.log('End marker placed at:', this.endPoint);
      console.log('Marker distance forward from raycast:', markerDistance);
      console.log('Final measurement:', finalDistance.toFixed(3), 'meters');
    }
    
    return finalDistance;
  }

  // Update marker positions when slider value changes
  updateMarkerPositions(currentPose) {
    if (!currentPose) return;
    
    const { position, direction } = this.getCameraTransform(currentPose);
        const markerDistance = this.ui ? this.ui.getMarkerDistance() : 0.0;
    
    if (this.startPoint) {
      this.startPoint = this.raycastToWorld(position, direction, 10.0, markerDistance);
      if (this.visualizer) {
        this.visualizer.createStartMarker(this.startPoint);
      }
    }
    
    if (this.endPoint) {
      this.endPoint = this.raycastToWorld(position, direction, 10.0, markerDistance);
      if (this.visualizer) {
        this.visualizer.createEndMarker(this.endPoint);
        // Update measurement line
        if (this.startPoint) {
          const distance = this.calculateDistance(this.startPoint, this.endPoint);
          this.visualizer.updateMeasurementLine(this.startPoint, this.endPoint, distance);
          
          // Update UI with new distance
          const finalDistance = distance / MONOCULAR_SCALE_FACTOR;
          if (this.ui) {
            this.ui.updateDistance(finalDistance);
          }
        }
      }
    }
  }

  resetMeasurement() {
    console.log('🔄 Resetting AR Ruler measurement...');
    
    this.startPoint = null;
    this.endPoint = null;
    this.measurementMode = 'placing';
    
    // Clear all visual elements
    if (this.visualizer) {
      this.visualizer.clearAll();
    }
    
    // Reset UI
    if (this.ui) {
      this.ui.updateDistance(0);
      this.ui.updateStatus('Place start marker');
      this.ui.updateNearestDistance(0);
    }
    
    console.log('✅ AR Ruler measurement reset complete');
  }

  updateMeasurement(currentPose) {
    if (this.measurementMode === 'measuring' && this.startPoint) {
      const { position, direction } = this.getCameraTransform(currentPose);
      const markerDistance = this.ui ? this.ui.getMarkerDistance() : 0.0;
      const currentEndPoint = this.raycastToWorld(position, direction, 10.0, markerDistance);
      const distance = this.calculateDistance(this.startPoint, currentEndPoint);
      
      if (this.ui) {
        this.ui.updateDistance(distance / MONOCULAR_SCALE_FACTOR); //divide by scale factor to get reverse scaled distance
      }
      
      if (this.visualizer) {
        this.visualizer.updateMeasurementLine(this.startPoint, currentEndPoint, distance);
      }
    }
  }
}
