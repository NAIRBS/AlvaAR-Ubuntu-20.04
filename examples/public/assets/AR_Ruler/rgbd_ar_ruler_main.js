// Import all the necessary functions and classes
import { MONOCULAR_SCALE_FACTOR, waitForEmscriptenModule, parseCalibrationYAML, drawPlaneOutlineOnFrame, ARRulerSystem } from './rgbd_ar_ruler_script.js';
import { ARRulerVisualizer, MeasurementUI } from './rgbd_ar_ruler_classes.js';

async function main(Module, Stats, ARSimpleView, ARSimpleMap, Video, THREE, isLiveMode = false) {
  const $container = document.getElementById('container');
  const $visualizerContainer = document.getElementById('visualizer-panel');
  const $view = document.createElement('div');
  const $canvas = document.createElement('canvas');
  const $overlay = document.getElementById('overlay');
  const $start = document.getElementById('start_button');
  const $splash = document.getElementById('splash');
  const splashFadeTime = 800;

  let alva, view, stats, sceneVisualizer;
  let mediaLeft, mediaRight;
  let arRulerSystem, visualizer, measurementUI;
  
  // Live mode variables
  let latestFrameBitmapLeft = null;
  let latestFrameBitmapRight = null;
  let image_width = 640;
  let image_height = 480;

  // WebSocket connection for live camera feed
  function connectWebSocketFrameStream(callback) {
    const ws = new WebSocket("ws://localhost:8765");
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      console.log("✅ Connected to WebSocket video stream");
    };
    ws.onerror = err => {
      console.error("❌ WebSocket error:", err);
    };
    ws.onclose = () => {
      console.warn("⚠️ WebSocket connection closed");
    };
    ws.onmessage = async event => {
      try {
        const arrayBuffer = event.data;
        const view = new Uint8Array(arrayBuffer);
        const sourceTag = String.fromCharCode(view[0]); // 'L' or 'R'
        const jpegData = view.slice(1);
        const blob = new Blob([jpegData], { type: 'image/jpeg' });
        const bitmap = await createImageBitmap(blob);
        callback(sourceTag, bitmap);
      } catch (err) {
        console.error("❌ Error processing WebSocket frame:", err);
      }
    };
  }

  async function demoStream() {
    const ModuleInstance = await Module();
    await waitForEmscriptenModule(ModuleInstance);
    
    // Fetch the YAML file and set it in the WASM module
    const yamlResponse = await fetch('./assets/d345i_640x480.yaml');
    const yamlText = await yamlResponse.text();
    if (typeof ModuleInstance.setStereoCalibrationYAML === 'function') {
      ModuleInstance.setStereoCalibrationYAML(yamlText);
    } else {
      console.error('setStereoCalibrationYAML is not available on the Module instance.');
    }
    
    // Parse calibration data from YAML for 3D point projection
    let leftCameraIntrinsics = null;
    try {
      leftCameraIntrinsics = parseCalibrationYAML(yamlText);
      console.log('Parsed left camera intrinsics:', leftCameraIntrinsics);
    } catch (e) {
      console.error('Failed to parse calibration YAML:', e);
    }
    
           // Persistent buffer allocation
     const leftFrameSize = 640 * 480 * 4;
     const framepointsBufSize = 4096 * 4;
     const leftPtr = ModuleInstance._malloc(leftFrameSize);
     const rightPtr = ModuleInstance._malloc(leftFrameSize);
     const framepointsBuf = ModuleInstance._malloc(framepointsBufSize);
    
    window.addEventListener('unload', () => {
      ModuleInstance._free(leftPtr);
      ModuleInstance._free(rightPtr);
      ModuleInstance._free(framepointsBuf);
    });
    
    alva = {
      findStereoCameraPose(leftFrame, rightFrame) {
        if (!ModuleInstance || typeof ModuleInstance.findStereoCameraPose !== 'function') {
          console.error('Emscripten Module or findStereoCameraPose not loaded');
          return null;
        }
        ModuleInstance.HEAPU8.set(leftFrame.data, leftPtr);
        ModuleInstance.HEAPU8.set(rightFrame.data, rightPtr);
        const posePtr = ModuleInstance._malloc(16 * 4);
        const ok = ModuleInstance.findStereoCameraPose(leftPtr, rightPtr, posePtr);
        let pose = null;
        if (ok) {
          pose = new Float32Array(ModuleInstance.HEAPF32.buffer, posePtr, 16).slice();
        }
        ModuleInstance._free(posePtr);
        return pose;
      },
      reset() {
        if (typeof ModuleInstance.reset === 'function') {
          ModuleInstance.reset();
        }
      },
      getFramePoints() {
        if (typeof ModuleInstance.getStereoFramePoints === 'function') {
          const n = 4096;
          const buf = ModuleInstance._malloc(n * 4 * 2); // 2 ints per point
          const numPoints = ModuleInstance.getStereoFramePoints(buf);
          const arr = new Int32Array(ModuleInstance.HEAP32.buffer, buf, numPoints * 2);
          const result = [];
          for (let i = 0; i < numPoints; ++i) {
            result.push({ x: arr[i * 2], y: arr[i * 2 + 1] });
          }
          ModuleInstance._free(buf);
          return result;
        }
        return [];
      },
      getFramePoints3D() {
        if (typeof ModuleInstance.getStereoFramePoints3D === 'function') {
          const n = 4096;
          const buf = ModuleInstance._malloc(n * 4 * 3); // 3 floats per 3D point
          const numPoints = ModuleInstance.getStereoFramePoints3D(buf);
          const arr = new Float32Array(ModuleInstance.HEAPF32.buffer, buf, numPoints * 3);
          const result = [];
          for (let i = 0; i < numPoints; ++i) {
            result.push(new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]));
          }
          ModuleInstance._free(buf);
          return result;
        }
        return [];
      }
    };

    // Load video sources based on mode
    if (isLiveMode) {
      // Live mode: Connect to WebSocket stream
      console.log("🎥 Starting live camera mode");
      connectWebSocketFrameStream((source, bitmap) => {
        if (source === 'L') latestFrameBitmapLeft = bitmap;
        else if (source === 'R') latestFrameBitmapRight = bitmap;
      });
    } else {
      // Video mode: Load pre-recorded videos
      console.log("🎬 Starting video mode");
      mediaLeft = await Video.Initialize('./assets/AR_Ruler/v2_ruler_left_web.mp4');
      mediaRight = await Video.Initialize('./assets/AR_Ruler/v2_ruler_right_web.mp4');
      mediaLeft.el.play();
      mediaLeft.el.loop = true;
      mediaRight.el.play();
      mediaRight.el.loop = true;
      
      // Add event listeners for video loop to refresh visualizer
      mediaLeft.el.addEventListener('ended', () => {
        console.log('Video looped - refreshing visualizer');
        refreshVisualizer();
      });
      
      mediaRight.el.addEventListener('ended', () => {
        console.log('Video looped - refreshing visualizer');
        refreshVisualizer();
      });
    }

           // Restrict $view overlay to left image only
     $view.style.position = 'absolute';
     $view.style.left = '0px';
     $view.style.top = '0px';
     $view.style.width = '640px';
     $view.style.height = '480px';
     $view.style.zIndex = '10';
     // Initialize 3D Scene Visualizer using ARSimpleMap like stereo visualizer
    sceneVisualizer = new ARSimpleMap($visualizerContainer, 400, 480);
    const camRenderer = new ARSimpleView($view, 640, 480, sceneVisualizer);
    
    // Make the camera helper bigger and red (like stereo visualizer)
    setTimeout(() => {
      if (sceneVisualizer.camHelper) {
        sceneVisualizer.camHelper.scale.set(1, 1, 1); // Make the camera frustum bigger
        sceneVisualizer.camHelper.visible = true; // Ensure it's visible
        sceneVisualizer.camHelper.material.color.setHex(0xff0000); // Red color
        sceneVisualizer.camHelper.material.needsUpdate = true;
        
        console.log('Camera helper scaled, made visible, and colored red');
      } else {
        console.log('Camera helper not found');
      }
    }, 100);
    
    // Store references for later use
    view = camRenderer;
    
    // Initialize AR Ruler system
    arRulerSystem = new ARRulerSystem();
    visualizer = new ARRulerVisualizer(view.scene, sceneVisualizer);
    measurementUI = new MeasurementUI();
    
    arRulerSystem.initialize(visualizer, measurementUI, view.camera, alva);
    
    // Add coordinate system indicator at the origin (1 unit = 25cm)
    const originAxes = new THREE.AxesHelper(0.25);
    originAxes.position.set(0, 0, 0);
    sceneVisualizer.scene.add(originAxes);
    
    // Add ambient lighting to make objects more visible
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    sceneVisualizer.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    sceneVisualizer.scene.add(directionalLight);
    
    // Add a status indicator text
    const statusCanvas = document.createElement('canvas');
    const statusContext = statusCanvas.getContext('2d');
    statusCanvas.width = 256;
    statusCanvas.height = 64;
    statusContext.fillStyle = '#333333';
    statusContext.font = 'Bold 20px Arial';
    statusContext.textAlign = 'center';
    statusContext.fillText('WAITING FOR', 128, 32);
    statusContext.fillText('SLAM POSE', 128, 56);
    
    const statusTexture = new THREE.CanvasTexture(statusCanvas);
    const statusGeometry = new THREE.PlaneGeometry(4, 1);
    const statusMaterial = new THREE.MeshBasicMaterial({ 
      map: statusTexture, 
      transparent: true, 
      side: THREE.DoubleSide 
    });
    const statusLabel = new THREE.Mesh(statusGeometry, statusMaterial);
    statusLabel.position.set(0, 2, 0);
    sceneVisualizer.scene.add(statusLabel);
    sceneVisualizer.statusLabel = statusLabel;

    // Setup UI callbacks
    measurementUI.onStartMarkerRequested = () => {
      if (latestPose) {
        arRulerSystem.placeStartMarker(latestPose);
      }
    };
    
    measurementUI.onEndMeasurementRequested = () => {
      if (latestPose) {
        const finalDistance = arRulerSystem.placeEndMarker(latestPose);
        console.log('Final measurement completed:', finalDistance.toFixed(3), 'meters');
      }
    };
    
    measurementUI.onResetRequested = () => {
      arRulerSystem.resetMeasurement();
    };
    
    measurementUI.onDrawPlaneRequested = () => {
      return arRulerSystem.drawNewPlane();
    };
    
    measurementUI.onClearPlaneRequested = () => {
      arRulerSystem.clearPlane();
    };

    stats = Stats;
    stats.add('total');
    stats.add('video');
    stats.add('slam');

    $container.appendChild($canvas);
    $container.appendChild($view);
    document.body.appendChild(stats.el);

    document.body.addEventListener("click", () => alva.reset(), false);

    let latestPose = null;
    let firstFrame = true;

    // Function to refresh/clear the visualizer when video loops
    function refreshVisualizer() {
      if (!sceneVisualizer) return;
      
      // Clear all feature points and dispose of Three.js resources
      if (sceneVisualizer.featurePoints) {
        sceneVisualizer.featurePoints.forEach(point => {
          sceneVisualizer.scene.remove(point);
          // Dispose of geometry and material to prevent memory leaks
          if (point.geometry) point.geometry.dispose();
          if (point.material) point.material.dispose();
        });
        sceneVisualizer.featurePoints = [];
      }
      
      // Reset camera helper visibility
      if (sceneVisualizer.camHelper) {
        sceneVisualizer.camHelper.visible = false;
      }
      
      // Reset the view (this will hide any created objects)
      if (view) {
        view.reset();
      }
      
      // Reset SLAM system
      if (alva && alva.reset) {
        alva.reset();
      }
      
      // Reset first frame flag
      firstFrame = true;
      
      // Clear pose tracking variables to prevent memory leaks
      window.lastValidPose = null;
      window.poseHistory = [];
      window.debugCounter = 0;
      window.featureDebugCounter = 0;
      
      // Dispose of shared geometry and material
      if (sceneVisualizer.featureGeometry) {
        sceneVisualizer.featureGeometry.dispose();
        sceneVisualizer.featureGeometry = null;
      }
      if (sceneVisualizer.featureMaterial) {
        sceneVisualizer.featureMaterial.dispose();
        sceneVisualizer.featureMaterial = null;
      }
      
      // Reset AR Ruler system
      if (arRulerSystem) {
        arRulerSystem.resetMeasurement();
      }
      
      console.log('Visualizer refreshed - all objects cleared and memory cleaned');
    }

    // Function to update the 3D scene visualizer - simplified like stereo visualizer
    function updateSceneVisualizer(pose) {
      if (!sceneVisualizer || !view) return;
      
      // MONOCULAR POSE: Use pose directly (no scaling needed)
      // The monocular SLAM pose is already at the correct scale for Three.js
      view.updateCameraPose(pose);
      
      // Debug: Log detailed coordinate information (only occasionally to prevent memory leaks)
      if (window.debugCounter === undefined) window.debugCounter = 0;
      window.debugCounter++;
      if (window.debugCounter % 60 === 0) { // Log every 60 frames (2 seconds at 30fps)
        console.log('=== MONOCULAR POSE DEBUG (Frame ' + window.debugCounter + ') ===');
        if (pose.length === 16) {
          console.log('Monocular pose (direct):', {x: pose[12].toFixed(3), y: pose[13].toFixed(3), z: pose[14].toFixed(3)});
        }
        console.log('Camera position:', view.camera.position);
        console.log('Using monocular SLAM pose directly (no scaling)');
      }
      
      // Update last valid pose for tracking
      if (window.lastValidPose) {
        window.lastValidPose = [...pose];
      } else {
        // Initialize tracking variables
        window.lastValidPose = [...pose];
      }
      
      // Ensure camera helper is visible, scaled, and colored red when pose is detected
      if (sceneVisualizer.camHelper) {
        sceneVisualizer.camHelper.visible = true;
        if (sceneVisualizer.camHelper.scale.x !== 1) {
          sceneVisualizer.camHelper.scale.set(1, 1, 1);
        }
        if (sceneVisualizer.camHelper.material.color.getHex() !== 0xff0000) {
          sceneVisualizer.camHelper.material.color.setHex(0xff0000);
          sceneVisualizer.camHelper.material.needsUpdate = true;
        }
      }
      
      // Update status label
      if (sceneVisualizer.statusLabel) {
        const statusCanvas = sceneVisualizer.statusLabel.material.map.image;
        const statusContext = statusCanvas.getContext('2d');
        statusContext.clearRect(0, 0, statusCanvas.width, statusCanvas.height);
        statusContext.fillStyle = '#00aa00';
        statusContext.font = 'Bold 20px Arial';
        statusContext.textAlign = 'center';
        statusContext.fillText('TRACKING', 128, 32);
        statusContext.fillText('ACTIVE', 128, 56);
        sceneVisualizer.statusLabel.material.map.needsUpdate = true;
      }
      
      // Debug: Log detailed coordinate information (only occasionally to prevent memory leaks)
      if (window.debugCounter === undefined) window.debugCounter = 0;
      window.debugCounter++;
      if (window.debugCounter % 60 === 0) { // Log every 60 frames (2 seconds at 30fps)
        console.log('=== COORDINATE DEBUG (Frame ' + window.debugCounter + ') ===');
        if (pose.length === 16) {
          console.log('Pose matrix translation (raw):', {x: pose[12], y: pose[13], z: pose[14]});
        }
        console.log('Camera position:', view.camera.position);
      }
      
      // No pose clamping - use raw SLAM poses directly
      
      // Visualize 3D feature points
      visualizeFeaturePoints();
    }
    
    // Function to visualize 3D feature points from SLAM
    function visualizeFeaturePoints() {
      if (!sceneVisualizer || !alva.getFramePoints3D) return;
      
      // Get 3D points from SLAM system
      const points3D = alva.getFramePoints3D();
      if (!points3D || points3D.length === 0) return;
      
      // Debug: Log feature point information (only occasionally to prevent memory leaks)
      if (window.featureDebugCounter === undefined) window.featureDebugCounter = 0;
      window.featureDebugCounter++;
      if (window.featureDebugCounter % 120 === 0) { // Log every 120 frames (4 seconds at 30fps)
        console.log('=== FEATURE POINTS DEBUG (Frame ' + window.featureDebugCounter + ') ===');
        console.log('Number of feature points:', points3D.length);
      }
      
      // Clear previous feature points and dispose of Three.js resources
      if (sceneVisualizer.featurePoints) {
        sceneVisualizer.featurePoints.forEach(point => {
          sceneVisualizer.scene.remove(point);
          // Dispose of geometry and material to prevent memory leaks
          if (point.geometry) point.geometry.dispose();
          if (point.material) point.material.dispose();
        });
      }
      sceneVisualizer.featurePoints = [];
      
      // Create shared geometry and material to reduce memory usage
      if (!sceneVisualizer.featureGeometry) { // FEATURE POINT SIZE
        //sceneVisualizer.featureGeometry = new THREE.SphereGeometry(0.2, 8, 8); // Increased from 0.02 to 0.05
        sceneVisualizer.featureGeometry = new THREE.SphereGeometry(0.004*MONOCULAR_SCALE_FACTOR, 8, 8); // Increased from 0.02 to 0.05
      }
      if (!sceneVisualizer.featureMaterial) {
        sceneVisualizer.featureMaterial = new THREE.MeshBasicMaterial({ 
          color: 0xff6600,
          transparent: true,
          opacity: 0.8
        });
      }
      
      // Create new feature points (limit to avoid performance issues)
      const maxPoints = Math.min(points3D.length, 200);
      for (let i = 0; i < maxPoints; i++) {
        const point3D = points3D[i];
        
        // Create sphere using shared geometry and material
        const sphere = new THREE.Mesh(sceneVisualizer.featureGeometry, sceneVisualizer.featureMaterial);
        // Apply the SAME coordinate transformation as the camera to maintain consistency
        // This matches the transformation in AlvaARConnectorTHREE: (x, -y, -z)
        // SCALE feature points to match monocular pose scale
        // Feature points come from stereo triangulation (metric scale) but need to match monocular pose scale
        const monocularScaleFactor = MONOCULAR_SCALE_FACTOR; // Adjust this based on monocular drift - stereo points are much larger than monocular pose
        sphere.position.set(point3D.x * monocularScaleFactor, -point3D.y * monocularScaleFactor, -point3D.z * monocularScaleFactor);
        
        sceneVisualizer.scene.add(sphere);
        sceneVisualizer.featurePoints.push(sphere);
      }
    }

    function render() {
      stats.next();
      stats.start('total');

               const spacing = 0;
       const boxWidth = image_width;
       const boxHeight = image_height;
       const width = image_width * 2 + spacing;
       const height = image_height;
       $canvas.width = width;
       $canvas.height = height;
      const ctx = $canvas.getContext('2d');
      ctx.clearRect(0, 0, $canvas.width, $canvas.height);

      let frameLeft = null;
      let frameRight = null;
      let pose = null;

      if (!document.hidden) {
        if (isLiveMode) {
          // Live mode: Use WebSocket frames
          if (latestFrameBitmapLeft && latestFrameBitmapRight) {
            // Convert bitmaps to ImageData for processing
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = image_width;
            tempCanvas.height = image_height;
            
            tempCtx.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
            frameLeft = tempCtx.getImageData(0, 0, image_width, image_height);
            
            tempCtx.clearRect(0, 0, image_width, image_height);
            tempCtx.drawImage(latestFrameBitmapRight, 0, 0, image_width, image_height);
            frameRight = tempCtx.getImageData(0, 0, image_width, image_height);
          } else {
            requestAnimationFrame(render);
            return;
          }
        } else {
          // Video mode: Use video elements
          frameLeft = mediaLeft.getImageData();
          frameRight = mediaRight.getImageData();
        }

        if (!frameLeft || !frameRight || !frameLeft.data.length || !frameRight.data.length) {
          requestAnimationFrame(render);
          return;
        }

        if (frameLeft && frameRight) {
          stats.start('video');
          
          if (isLiveMode) {
            // Live mode: Draw bitmaps directly
            ctx.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
            ctx.drawImage(latestFrameBitmapRight, image_width + spacing, 0, image_width, image_height);
          } else {
            // Video mode: Draw ImageData
            ctx.putImageData(frameLeft, 0, 0);
            ctx.putImageData(frameRight, image_width + spacing, 0);
          }
          
          stats.stop('video');
          stats.start('slam');
          
          if (frameLeft && frameRight && frameLeft.data.length && frameRight.data.length) {
            if (firstFrame) {
              alva.reset();  // Reset LK tracker on first valid frame
              firstFrame = false;
            }
            pose = alva.findStereoCameraPose(frameLeft, frameRight);
          }
          stats.stop('slam');
          
          if (pose) {
            latestPose = pose;
            
            // Use the standard ARSimpleView updateCameraPose method like stereo visualizer
            view.updateCameraPose(pose);
            
            // Update AR Ruler measurement
            arRulerSystem.updateMeasurement(pose);
            
            // Update 3D point count in status
            if (arRulerSystem && arRulerSystem.alva && arRulerSystem.alva.getFramePoints3D) {
              const points3D = arRulerSystem.alva.getFramePoints3D();
              const pointCount = points3D ? points3D.length : 0;
              if (pointCount > 0 && window.debugCounter % 60 === 0) {
                console.log(`📊 Current 3D points: ${pointCount} (need 20+ for plane detection)`);
              }
            }
            
            // Update 3D Scene Visualizer
            updateSceneVisualizer(pose);
          } else {
            view.lostCamera();
          }

          // Draw 3D stereo frame points projected onto left camera
          if (pose && alva.getFramePoints3D) {
            const points3D = alva.getFramePoints3D();
            if (points3D && points3D.length > 0) {
              // Use parsed calibration data from YAML file
              let fx = 525, fy = 525, cx = 320, cy = 240; // Default fallback values
              
              if (leftCameraIntrinsics) {
                fx = leftCameraIntrinsics.fx;
                fy = leftCameraIntrinsics.fy;
                cx = leftCameraIntrinsics.cx;
                cy = leftCameraIntrinsics.cy;
              } else {
                // Fallback: try to get from WASM module if YAML parsing failed
                if (typeof ModuleInstance.getLeftCameraIntrinsics === 'function') {
                  try {
                    const intrinsics = ModuleInstance.getLeftCameraIntrinsics();
                    if (intrinsics && intrinsics.length >= 4) {
                      fx = intrinsics[0];
                      fy = intrinsics[1];
                      cx = intrinsics[2];
                      cy = intrinsics[3];
                    }
                  } catch (e) {
                    console.log('Could not get camera intrinsics from module, using defaults');
                  }
                }
              }
              
              // Debug: Log calibration info occasionally
              if (window.debugCounter % 120 === 0) {
                console.log('Using camera intrinsics from YAML:', {fx, fy, cx, cy});
                console.log('Projecting', points3D.length, '3D points to 2D');
              }
              
              for (const point3D of points3D) {
                // Project 3D point to 2D image coordinates using pinhole camera model
                // Note: points3D are in stereo coordinate system, need to project to left camera
                const x = (point3D.x * fx / point3D.z) + cx;
                const y = (point3D.y * fy / point3D.z) + cy;
                
                // Only draw points that are in front of camera and within image bounds
                if (point3D.z > 0.1 && x >= 0 && x < 640 && y >= 0 && y < 480) {
                  // Color based on depth (closer = brighter, farther = darker)
                  const depth = Math.min(point3D.z / 5.0, 1.0); // Normalize depth to 0-1 (5m max)
                  const intensity = Math.floor(255 * (1.0 - depth)); // Closer points are brighter
                  
                  // Use different colors for different depth ranges
                  if (point3D.z < 1.0) {
                    ctx.fillStyle = `rgb(255, ${intensity}, ${intensity})`; // Red for very close
                  } else if (point3D.z < 2.0) {
                    ctx.fillStyle = `rgb(${intensity}, 255, ${intensity})`; // Green for close
                  } else {
                    ctx.fillStyle = `rgb(${intensity}, ${intensity}, 255)`; // Blue for far
                  }
                  
                  // Size based on depth (closer = larger)
                  const size = Math.max(1, Math.floor(4 * (1.0 - depth)));
                  ctx.fillRect(x - size/2, y - size/2, size, size);
                }
              }
            }
          } else {
            // Fallback to original 2D keypoints if 3D points not available
            const dots = alva.getFramePoints();
            for (const p of dots) {
              ctx.fillStyle = 'white';
              ctx.fillRect(p.x, p.y, 2, 2);
            }
          }

          // Draw detected plane outline on left frame if plane mode is enabled
          if (arRulerSystem && arRulerSystem.usePlaneMode && arRulerSystem.detectedPlane && pose) {
            drawPlaneOutlineOnFrame(ctx, arRulerSystem.detectedPlane, pose, leftCameraIntrinsics);
          }
                     } else if (frameLeft) {
          if (isLiveMode && latestFrameBitmapLeft) {
            ctx.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
          } else {
            ctx.putImageData(frameLeft, 0, 0);
          }
           ctx.fillStyle = "rgba(0,0,0,0.6)";
           ctx.fillRect(0, 0, 110, 25);
           ctx.fillStyle = "white";
           ctx.font = "16px Helvetica";
           ctx.fillText("Left Camera", 10, 18);
         }
         if (frameRight) {
          if (isLiveMode && latestFrameBitmapRight) {
            ctx.drawImage(latestFrameBitmapRight, image_width, 0, image_width, image_height);
          } else {
            ctx.putImageData(frameRight, image_width, 0);
          }
           ctx.fillStyle = "rgba(0,0,0,0.6)";
           ctx.fillRect(image_width, 0, 120, 25);
           ctx.fillStyle = "white";
           ctx.font = "16px Helvetica";
           ctx.fillText("Right Camera", image_width + 10, 18);
         }
         ctx.beginPath();
         ctx.moveTo(image_width, 0);
         ctx.lineTo(image_width, image_height);
         ctx.strokeStyle = "#333";
         ctx.lineWidth = 2;
         ctx.stroke();
      }
      stats.stop('total');
      stats.render();
      requestAnimationFrame(render);
    }
    render();
  }

  setTimeout(() => {
    $splash.remove();
    $start.addEventListener('click', () => {
      $overlay.remove();
      demoStream();
    }, { once: true });
  }, splashFadeTime);
}

// Export the main function so it can be imported and called
export { main };
