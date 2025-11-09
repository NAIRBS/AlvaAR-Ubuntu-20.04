// Video Player System for AR Video Display
import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/build/three.module.js';
import { MONOCULAR_SCALE_FACTOR } from '../rgbd_ar_ruler_script.js';

// Extract YouTube video ID from various URL formats
// CRITICAL: Must extract ID correctly to use /embed/ endpoint (not /watch/)
export function extractYouTubeVideoId(url) {
  if (!url) return null;
  
  // Handle various YouTube URL formats
  // Pattern order matters - more specific patterns first
  const patterns = [
    // youtu.be short URLs: https://youtu.be/VIDEO_ID?list=...
    /(?:youtu\.be\/)([^&\n?#]+)/,
    // youtube.com/watch URLs: https://www.youtube.com/watch?v=VIDEO_ID&list=...
    /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/,
    // youtube.com/embed URLs: https://www.youtube.com/embed/VIDEO_ID
    /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
    // youtube.com/v URLs: https://www.youtube.com/v/VIDEO_ID
    /(?:youtube\.com\/v\/)([^&\n?#]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      const videoId = match[1];
      console.log('✅ [DEBUG] Extracted video ID:', videoId, 'from URL:', url);
      return videoId;
    }
  }
  
  console.error('❌ [DEBUG] Failed to extract video ID from URL:', url);
  return null;
}

// Check if URL is a YouTube URL
export function isYouTubeURL(url) {
  return /youtube\.com|youtu\.be/.test(url);
}

// Create YouTube embed URL
// CRITICAL: Must use /embed/ endpoint, NOT /watch/ endpoint
// Reference: https://forum.freecodecamp.org/t/youtube-refused-to-connect/245262
// The /embed endpoint allows outside requests, /watch does not
export function createYouTubeEmbedURL(videoId) {
  if (!videoId) {
    console.error('❌ [DEBUG] Cannot create embed URL: videoId is null/undefined');
    return null;
  }
  
  // Use mute=1 to enable autoplay (browsers block autoplay with sound)
  // User can unmute using YouTube's built-in controls
  // CRITICAL: Must use /embed/ not /watch/
  const url = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=1&rel=0&enablejsapi=1&playsinline=1`;
  
  // Validate URL format
  if (!url.includes('/embed/')) {
    console.error('❌ [DEBUG] ERROR: URL does not use /embed/ endpoint!', url);
    return null;
  }
  
  if (url.includes('/watch')) {
    console.error('❌ [DEBUG] ERROR: URL incorrectly uses /watch/ endpoint!', url);
    return null;
  }
  
  console.log('🔗 [DEBUG] Creating YouTube embed URL:', url);
  console.log('📋 [DEBUG] URL validation:', {
    hasVideoId: url.includes(videoId),
    usesEmbedEndpoint: url.includes('/embed/'),
    doesNotUseWatch: !url.includes('/watch'),
    hasAutoplay: url.includes('autoplay=1'),
    hasMute: url.includes('mute=1'),
    hasEnablejsapi: url.includes('enablejsapi=1')
  });
  return url;
}

// Video Player System
export class VideoPlayerSystem {
  constructor() {
    this.videoPosition = null;
    this.videoURL = null;
    this.visualizer = null;
    this.ui = null;
    this.camera = null;
    this.alva = null;
  }

  initialize(visualizer, ui, camera, alva) {
    this.visualizer = visualizer;
    this.ui = ui;
    this.camera = camera;
    this.alva = alva;
  }

  // Get camera position and direction from pose matrix
  // This matches the AR ruler transformation exactly for consistency
  getCameraTransform(poseMatrix) {
    if (!poseMatrix || poseMatrix.length !== 16) {
      return { position: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 0, -1) };
    }

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

  // Calculate distance to nearest environment point along the crosshair direction
  // This matches the logic from AR ruler for consistent marker placement
  calculateNearestDistance(cameraPosition, cameraDirection, maxDistance = 10.0) {
    // Create a ray from camera position in camera direction
    const rayOrigin = cameraPosition.clone();
    const rayDirection = cameraDirection.clone();
    
    // Note: Plane mode is not implemented in video player, but we keep the structure
    // for potential future use. For now, we always use 3D point raycasting.
    
    // Fallback to 3D point raycasting
    // Get 3D frame points from SLAM system
    if (!this.alva || !this.alva.getFramePoints3D) {
      console.log('No alva or getFramePoints3D available');
      return 2.0;
    }
    
    const points3D = this.alva.getFramePoints3D();
    
    if (!points3D || points3D.length === 0) {
      console.log('No 3D points available');
      return 2.0;
    }
    
    let nearestDistance = Infinity;
    let nearestPoint = null;
    let bestRayAlignment = Infinity;
    
    // IMPROVED ALGORITHM: Prioritize ray alignment over distance for better placement
    // This matches the AR ruler logic exactly
    for (const point3D of points3D) {
      // Apply the SAME coordinate transformation as the camera to maintain consistency
      // This matches the transformation in AlvaARConnectorTHREE: (x, -y, -z)
      const transformedPoint = new THREE.Vector3(point3D.x, -point3D.y, -point3D.z);
      
      // Calculate distance from camera to this point
      const distanceFromCamera = transformedPoint.distanceTo(rayOrigin);
      
      // Only consider points in front of the camera (not behind)
      const pointToRayOrigin = transformedPoint.clone().sub(rayOrigin);
      const projectionLength = pointToRayOrigin.dot(rayDirection);
      
      // Check if point is in front of camera (projectionLength > 0)
      if (projectionLength > 0.01) { // Reduced from 0.1 to 0.01 for more sensitivity
        // Calculate the perpendicular distance from the point to the ray line
        // This gives us how close the point is to the raycasted center direction
        const closestPointOnRay = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(projectionLength));
        const perpendicularDistance = transformedPoint.distanceTo(closestPointOnRay);
        
        // PRIORITIZE RAY ALIGNMENT: Use stricter tolerance for better alignment
        const rayTolerance = 0.05; // 5cm tolerance - stricter for better alignment
        
        if (perpendicularDistance < rayTolerance) {
          // This point is well-aligned with the ray
          // PRIORITY: 1) Ray alignment (better alignment is better), 2) Distance (closer is better)
          const rayAlignmentScore = perpendicularDistance; // Direct perpendicular distance
          
          // Check if this is the best point so far
          // Priority: 1) Ray alignment (smaller perpendicular distance is better), 2) Distance (closer is better)
          const isBetter = (rayAlignmentScore < bestRayAlignment) || 
                          (rayAlignmentScore === bestRayAlignment && distanceFromCamera < nearestDistance);
          
          if (isBetter) {
            nearestDistance = distanceFromCamera;
            nearestPoint = transformedPoint;
            bestRayAlignment = rayAlignmentScore;
          }
        }
      }
    }
    
    // Return the nearest distance if found, otherwise fallback
    if (nearestDistance !== Infinity) {
      return nearestDistance;
    }
    
    // Fallback: return fixed distance
    return 2.0;
  }

  // Raycast from camera center to find nearest 3D frame point with improved search
  // This matches the AR ruler logic exactly for consistent placement
  raycastToWorld(cameraPosition, cameraDirection, maxDistance = 10.0, videoDistanceForward = 0.5) {
    // Use the improved distance calculation that finds the ABSOLUTE nearest point
    const nearestDistance = this.calculateNearestDistance(cameraPosition, cameraDirection, maxDistance);
    
    // Create a ray from camera position in camera direction
    const rayOrigin = cameraPosition.clone();
    const rayDirection = cameraDirection.clone();
    
    // Place the video at the raycasted point, then move it further along the ray by the specified distance
    const raycastPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(nearestDistance));
    const videoPosition = raycastPoint.clone().add(rayDirection.clone().multiplyScalar(videoDistanceForward));
    
    return videoPosition;
  }

  // Place video at world point under crosshair
  placeVideo(currentPose, videoURL) {
    const { position, direction } = this.getCameraTransform(currentPose);
    // Default 0.5m ahead, slider adds to that (so 0 on slider = 0.5m, slider adds more)
    const baseDistance = 0.5;
    const sliderDistance = this.ui ? this.ui.getVideoDistance() : 0.0;
    const videoDistance = baseDistance + sliderDistance;
    this.videoPosition = this.raycastToWorld(position, direction, 10.0, videoDistance);
    this.videoURL = videoURL;
    
    console.log('Camera position:', position);
    console.log('Camera direction:', direction);
    console.log('Video distance forward from raycast:', videoDistance, '(base 0.5m + slider', sliderDistance, 'm)');
    console.log('Video placed at:', this.videoPosition);
    console.log('Video URL:', videoURL);
    
    if (this.visualizer) {
      this.visualizer.createVideo(this.videoPosition, videoURL);
    }
    
    if (this.ui) {
      this.ui.updateStatus('Video placed - click to place another');
    }
  }

  // Update video position when distance slider changes
  updateVideoPosition(currentPose) {
    if (!this.videoPosition || !currentPose) return;
    
    const { position, direction } = this.getCameraTransform(currentPose);
    // Default 0.5m ahead, slider adds to that (so 0 on slider = 0.5m, slider adds more)
    const baseDistance = 0.5;
    const sliderDistance = this.ui ? this.ui.getVideoDistance() : 0.0;
    const videoDistance = baseDistance + sliderDistance;
    const newPosition = this.raycastToWorld(position, direction, 10.0, videoDistance);
    
    this.videoPosition.copy(newPosition);
    
    if (this.visualizer) {
      this.visualizer.updateVideoPosition(this.videoPosition);
    }
  }

  // Reset video placement
  resetVideo() {
    this.videoPosition = null;
    this.videoURL = null;
    
    if (this.visualizer) {
      this.visualizer.removeVideo();
    }
    
    if (this.ui) {
      this.ui.updateStatus('Click left frame to place video');
    }
  }
}

