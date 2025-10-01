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
  let showRightCamera = false;
  let image_width = 752;
  let image_height = 480;

  // WebSocket error display functions
  function showWebSocketError(message) {
    // Remove any existing error message
    hideWebSocketError();
    
    // Create error message element
    const errorDiv = document.createElement('div');
    errorDiv.id = 'websocket-error';
    errorDiv.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #dc3545;
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      font-family: 'Helvetica', sans-serif;
      font-size: 14px;
      font-weight: bold;
      text-align: center;
      max-width: 500px;
      word-wrap: break-word;
    `;
    errorDiv.textContent = message;
    
    // Add to document
    document.body.appendChild(errorDiv);
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
      hideWebSocketError();
    }, 10000);
  }

  function hideWebSocketError() {
    const existingError = document.getElementById('websocket-error');
    if (existingError) {
      existingError.remove();
    }
  }

  // WebSocket connection for live camera feed
  function connectWebSocketFrameStream(callback) {
    const ws = new WebSocket("ws://localhost:8765");
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      console.log("✅ Connected to WebSocket video stream");
      // Hide any previous error messages
      hideWebSocketError();
    };
    ws.onerror = err => {
      console.error("❌ WebSocket error:", err);
      showWebSocketError("Failed to connect to live camera stream. Please ensure the camera server is running on localhost:8765");
    };
    ws.onclose = () => {
      console.warn("⚠️ WebSocket connection closed");
      showWebSocketError("Live camera connection lost. Attempting to reconnect...");
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
    const yamlResponse = await fetch('./Testing/V1_01_easy/V1-01-EASY-config.yaml');
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
     const leftFrameSize = 752 * 480 * 4;
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
      getFrameKeypoints() {
        if (typeof ModuleInstance.getStereoFrameKeypoints === 'function') {
          const n = 4096;
          const buf = ModuleInstance._malloc(n * 4 * 2); // 2 ints per point
          const numPoints = ModuleInstance.getStereoFrameKeypoints(buf);
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
      getFramePoints() {
        if (typeof ModuleInstance.getStereoFramePoints === 'function') {
          const n = 4096;
          const buf = ModuleInstance._malloc(n * 4 * 3); // 3 floats per 3D point
          const numPoints = ModuleInstance.getStereoFramePoints(buf);
          const arr = new Float32Array(ModuleInstance.HEAPF32.buffer, buf, numPoints * 3);
          const result = [];
          for (let i = 0; i < numPoints; ++i) {
            result.push(new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]));
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
     mediaLeft = await Video.Initialize('./Testing/V1_01_easy/left_camera.mp4');
     mediaRight = await Video.Initialize('./Testing/V1_01_easy/right_camera.mp4');
      mediaLeft.el.play();
      mediaLeft.el.loop = true;
      mediaRight.el.play();
      mediaRight.el.loop = true;
      
      // Only listen to left video loop detection to avoid double resets
      mediaLeft.el.addEventListener('ended', () => {
        console.log('Video looped (ended event) - refreshing visualizer');
        refreshVisualizer();
      });
      
      // Alternative: Listen for 'timeupdate' to detect when video restarts
      let lastTimeLeft = 0;
      let loopDetectedLeft = false;
      
      mediaLeft.el.addEventListener('timeupdate', () => {
        const currentTime = mediaLeft.el.currentTime;
        // Detect if video jumped back to start (loop occurred)
        if (currentTime < lastTimeLeft && lastTimeLeft > 1.0 && !loopDetectedLeft) {
          console.log('Video looped (timeupdate detection) - refreshing visualizer');
          loopDetectedLeft = true;
          refreshVisualizer();
          // Reset flag after a delay
          setTimeout(() => { loopDetectedLeft = false; }, 1000);
        }
        lastTimeLeft = currentTime;
      });
      
      // Additional: Listen for 'seeking' event which might indicate loop
      mediaLeft.el.addEventListener('seeking', () => {
        console.log('Video seeking detected - might be loop');
        // Add a small delay to check if it's actually a loop
        setTimeout(() => {
          if (mediaLeft.el.currentTime < 0.5) {
            console.log('Video looped (seeking detection) - refreshing visualizer');
            refreshVisualizer();
          }
        }, 100);
      });
    }

           // Restrict $view overlay to left image only
     $view.style.position = 'absolute';
     $view.style.left = '0px';
     $view.style.top = '0px';
     $view.style.width = '752px';
     $view.style.height = '480px';
     $view.style.zIndex = '10';
     // Initialize 3D Scene Visualizer using ARSimpleMap like stereo visualizer
    sceneVisualizer = new ARSimpleMap($visualizerContainer, 400, 480);
    const camRenderer = new ARSimpleView($view, 752, 480, sceneVisualizer);
    
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
    
    // Add toggle button for right camera visibility
    const toggleRightCameraBtn = document.getElementById('toggle-right-camera');
    if (toggleRightCameraBtn) {
      // Set initial button text based on default state (hidden)
      toggleRightCameraBtn.textContent = 'Show Right Camera';
      
      toggleRightCameraBtn.addEventListener('click', () => {
        showRightCamera = !showRightCamera;
        toggleRightCameraBtn.textContent = showRightCamera ? 'Hide Right Camera' : 'Show Right Camera';
      });
    }
    
     // Test: Ensure the nearest distance display is visible
     const nearestDisplay = document.getElementById('nearest-distance-display');
     if (nearestDisplay) {
       nearestDisplay.textContent = 'Nearest: Ready...';
       nearestDisplay.style.display = 'block';
       nearestDisplay.style.visibility = 'visible';
       console.log('✅ Found nearest-distance-display element during initialization');
     } else {
       console.error('❌ nearest-distance-display element NOT FOUND during initialization!');
       // Let's check what's actually in the DOM
       const measurementPanel = document.getElementById('measurement-panel');
       if (measurementPanel) {
         console.log('Measurement panel HTML:', measurementPanel.innerHTML);
       } else {
         console.error('measurement-panel not found either!');
       }
     }
     
     // Test: Check again after a delay to see if element appears
     setTimeout(() => {
       const delayedTest = document.getElementById('nearest-distance-display');
       if (delayedTest) {
         console.log('✅ Found nearest-distance-display element after delay');
         delayedTest.textContent = 'Nearest: Found after delay!';
       } else {
         console.error('❌ nearest-distance-display element still not found after delay!');
       }
     }, 1000);
     
     arRulerSystem.initialize(visualizer, measurementUI, view.camera, alva);
    
    // Add coordinate system indicator at the origin (1 unit = 25cm)
    const originAxes = new THREE.AxesHelper(0.25);
    originAxes.position.set(0, 0, 0);
    sceneVisualizer.scene.add(originAxes);
    
    // Add camera frustum visualization for pose debugging
    let cameraFrustum = null;
    let cameraMarker = null;
    function createCameraFrustum(position, rotation, fov = 60, aspect = 752/480, near = 0.1, far = 10) {
      // Remove existing frustum
      if (cameraFrustum) {
        sceneVisualizer.scene.remove(cameraFrustum);
      }
      
      // Remove existing camera marker
      if (cameraMarker) {
        sceneVisualizer.scene.remove(cameraMarker);
      }
      
      // Camera frustum removed - only showing position marker
      
      // Add camera position marker (smaller dot)
      const cameraMarkerGeometry = new THREE.SphereGeometry(0.005, 8, 8); // Much smaller: 0.005 instead of 0.02
      const cameraMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      cameraMarker = new THREE.Mesh(cameraMarkerGeometry, cameraMarkerMaterial);
      cameraMarker.position.copy(position);
      sceneVisualizer.scene.add(cameraMarker);
      
      return cameraFrustum;
    }
    
    // Store the createCameraFrustum function globally for use in render loop
    window.createCameraFrustum = createCameraFrustum;
    
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
    
    measurementUI.onMarkerDistanceChanged = (distance) => {
      // Update existing markers when slider value changes
      if (latestPose) {
        arRulerSystem.updateMarkerPositions(latestPose);
      }
    };
    
    // Setup pose export button handlers
    document.getElementById('export-poses').addEventListener('click', () => {
      exportPoseData();
    });
    
    document.getElementById('clear-poses').addEventListener('click', () => {
      poseExportData = [];
      frameCounter = 0;
      console.log('Pose export data cleared');
    });

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
    
    // Pose export functionality
    let poseExportData = [];
    let frameCounter = 0;
    let startTime = null;
    
    // Function to convert 16-element pose matrix to 7-element pose (position + quaternion)
    function poseMatrixTo7Element(poseMatrix) {
      if (!poseMatrix || poseMatrix.length !== 16) {
        return null;
      }
      
      // Extract translation (position)
      const position_x = poseMatrix[12];
      const position_y = poseMatrix[13];
      const position_z = poseMatrix[14];
      
      // Extract rotation matrix and convert to quaternion
      const R = [
        [poseMatrix[0], poseMatrix[1], poseMatrix[2]],
        [poseMatrix[4], poseMatrix[5], poseMatrix[6]],
        [poseMatrix[8], poseMatrix[9], poseMatrix[10]]
      ];
      
      // Convert rotation matrix to quaternion
      const trace = R[0][0] + R[1][1] + R[2][2];
      let orientation_w, orientation_x, orientation_y, orientation_z;
      
      if (trace > 0) {
        const s = Math.sqrt(trace + 1.0) * 2; // s = 4 * qw
        orientation_w = 0.25 * s;
        orientation_x = (R[2][1] - R[1][2]) / s;
        orientation_y = (R[0][2] - R[2][0]) / s;
        orientation_z = (R[1][0] - R[0][1]) / s;
      } else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
        const s = Math.sqrt(1.0 + R[0][0] - R[1][1] - R[2][2]) * 2; // s = 4 * qx
        orientation_w = (R[2][1] - R[1][2]) / s;
        orientation_x = 0.25 * s;
        orientation_y = (R[0][1] + R[1][0]) / s;
        orientation_z = (R[0][2] + R[2][0]) / s;
      } else if (R[1][1] > R[2][2]) {
        const s = Math.sqrt(1.0 + R[1][1] - R[0][0] - R[2][2]) * 2; // s = 4 * qy
        orientation_w = (R[0][2] - R[2][0]) / s;
        orientation_x = (R[0][1] + R[1][0]) / s;
        orientation_y = 0.25 * s;
        orientation_z = (R[1][2] + R[2][1]) / s;
      } else {
        const s = Math.sqrt(1.0 + R[2][2] - R[0][0] - R[1][1]) * 2; // s = 4 * qz
        orientation_w = (R[1][0] - R[0][1]) / s;
        orientation_x = (R[0][2] + R[2][0]) / s;
        orientation_y = (R[1][2] + R[2][1]) / s;
        orientation_z = 0.25 * s;
      }
      
      return {
        position_x,
        position_y,
        position_z,
        orientation_w,
        orientation_x,
        orientation_y,
        orientation_z
      };
    }
    
    // Function to export pose data as CSV
    function exportPoseData() {
      if (poseExportData.length === 0) {
        console.log('No pose data to export');
        return;
      }
      
      // Create CSV header
      const csvHeader = 'timestamp_ns,filename,position_x,position_y,position_z,orientation_w,orientation_x,orientation_y,orientation_z,velocity_x,velocity_y,velocity_z\n';
      
      // Create CSV content
      const csvContent = poseExportData.map(pose => {
        return `${pose.timestamp_ns},${pose.filename},${pose.position_x},${pose.position_y},${pose.position_z},${pose.orientation_w},${pose.orientation_x},${pose.orientation_y},${pose.orientation_z},0.0,0.0,0.0`;
      }).join('\n');
      
      const fullCsv = csvHeader + csvContent;
      
      // Create and download file
      const blob = new Blob([fullCsv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `estimated_poses_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      console.log(`Exported ${poseExportData.length} pose estimates to CSV`);
    }
    
    // Function to add pose to export data
    function addPoseToExport(poseMatrix) {
      if (!poseMatrix || poseMatrix.length !== 16) return;
      
      const pose7 = poseMatrixTo7Element(poseMatrix);
      if (!pose7) return;
      
      // Generate timestamp (nanoseconds since epoch)
      const timestamp = Date.now() * 1000000; // Convert to nanoseconds
      
      // Generate filename (frame number)
      const filename = `frame_${frameCounter.toString().padStart(6, '0')}.png`;
      
      // Add to export data
      poseExportData.push({
        timestamp_ns: timestamp,
        filename: filename,
        position_x: pose7.position_x,
        position_y: pose7.position_y,
        position_z: pose7.position_z,
        orientation_w: pose7.orientation_w,
        orientation_x: pose7.orientation_x,
        orientation_y: pose7.orientation_y,
        orientation_z: pose7.orientation_z
      });
      
      frameCounter++;
      
      // Update pose counter display
      const poseCounterDisplay = document.getElementById('pose-counter-display');
      if (poseCounterDisplay) {
        poseCounterDisplay.textContent = `Poses captured: ${poseExportData.length}`;
      }
    }

    // Function to refresh/clear the visualizer when video loops
    function refreshVisualizer() {
      if (!sceneVisualizer) return;
      
      console.log('Video looped - resetting everything...');
      
      // Clear all feature points
      if (sceneVisualizer.featurePoints) {
        sceneVisualizer.featurePoints.forEach(point => {
          sceneVisualizer.scene.remove(point);
          if (point.geometry) point.geometry.dispose();
          if (point.material) point.material.dispose();
        });
        sceneVisualizer.featurePoints = [];
      }
      
      // Reset camera helper
      if (sceneVisualizer.camHelper) {
        sceneVisualizer.camHelper.visible = false;
        sceneVisualizer.camHelper.position.set(0, 0, 0);
        sceneVisualizer.camHelper.quaternion.set(0, 0, 0, 1);
      }
      
      // Reset view
      if (view) {
        view.reset();
        view.camera.position.set(0, 0, 0);
        view.camera.quaternion.set(0, 0, 0, 1);
      }
      
      // Reset SLAM system
      if (alva && alva.reset) {
        alva.reset();
      }
      
      // Reset AR Ruler system
      if (arRulerSystem) {
        arRulerSystem.resetMeasurement();
        arRulerSystem.startPoint = null;
        arRulerSystem.endPoint = null;
        arRulerSystem.measurementMode = 'idle';
        arRulerSystem.detectedPlane = null;
        arRulerSystem.usePlaneMode = false;
        arRulerSystem.planePoints = [];
      }
      
      // Reset UI
      if (measurementUI) {
        measurementUI.reset();
      }
      
      // Clear pose tracking
      firstFrame = true;
      latestPose = null;
      window.lastValidPose = null;
      window.poseHistory = [];
      window.debugCounter = 0;
      window.featureDebugCounter = 0;
      
      // Dispose of shared resources
      if (sceneVisualizer.featureGeometry) {
        sceneVisualizer.featureGeometry.dispose();
        sceneVisualizer.featureGeometry = null;
      }
      if (sceneVisualizer.featureMaterial) {
        sceneVisualizer.featureMaterial.dispose();
        sceneVisualizer.featureMaterial = null;
      }
      
      console.log('Reset complete');
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
      if (window.debugCounter % 150 === 0) { // Log every 150 frames (5 seconds at 30fps)
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
        
        // Log scale factor and baseline information for V1-01 Easy
        if (points3D.length > 0) {
          const samplePoint = points3D[0];
          console.log('V1-01 Easy Baseline Analysis:');
          console.log('  - Baseline: 52.404 pixels (vs 19.202267 for d345i)');
          console.log('  - Baseline ratio: 2.73x larger');
          console.log('  - Current scale factor:', MONOCULAR_SCALE_FACTOR);
          console.log('  - Sample 3D point:', {x: samplePoint.x, y: samplePoint.y, z: samplePoint.z});
          console.log('  - Distance from origin:', Math.sqrt(samplePoint.x**2 + samplePoint.y**2 + samplePoint.z**2));
        }
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
        // V1-01 Easy has 2.73x larger baseline, so stereo points should be more accurate
        // May need different scale factor than the default MONOCULAR_SCALE_FACTOR
        const monocularScaleFactor = MONOCULAR_SCALE_FACTOR; // TODO: Test if this needs adjustment for V1-01 Easy baseline
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
       const width = showRightCamera ? (image_width * 2 + spacing) : image_width;
       const height = image_height;
       $canvas.width = width;
       $canvas.height = height;
       
       // Update container width to match canvas
       $container.style.width = width + 'px';
       
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
            // Live mode: Draw bitmaps directly - always draw left camera at original size
            ctx.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
            if (showRightCamera) {
              ctx.drawImage(latestFrameBitmapRight, image_width + spacing, 0, image_width, image_height);
            }
          } else {
            // Video mode: Draw ImageData - always draw left camera at original size
            ctx.putImageData(frameLeft, 0, 0);
            if (showRightCamera) {
              ctx.putImageData(frameRight, image_width + spacing, 0);
            }
          }
          
          // Add camera labels
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(0, 0, 170, 25);
          ctx.fillStyle = "white";
          ctx.font = "16px Helvetica";
          ctx.fillText("Left Camera (Stereo)", 10, 18);

          if (showRightCamera) {
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillRect(image_width + spacing, 0, 120, 25);
            ctx.fillStyle = "white";
            ctx.fillText("Right Camera", image_width + spacing + 10, 18);
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
            
            // Export pose data for ground truth comparison
            addPoseToExport(pose);
            
            // Use the standard ARSimpleView updateCameraPose method like stereo visualizer
            view.updateCameraPose(pose);
            
            // Update AR Ruler measurement
            arRulerSystem.updateMeasurement(pose);
            
            // Calculate and display nearest distance
            const { position, direction } = arRulerSystem.getCameraTransform(pose);
            //console.log('Calculating nearest distance for position:', position, 'direction:', direction);
            const nearestDistance = arRulerSystem.calculateNearestDistance(position, direction);
            //console.log('Calculated nearest distance:', nearestDistance);
            
             // Always update the display directly
             let nearestDisplay = document.getElementById('nearest-distance-display');
             if (nearestDisplay) {
               nearestDisplay.textContent = `Nearest: ${nearestDistance.toFixed(3)} meters`;
             } else {
               console.error('nearest-distance-display element not found! Creating it...');
               // Try to create the element
               const measurementPanel = document.getElementById('measurement-panel');
               if (measurementPanel) {
                 const newElement = document.createElement('div');
                 newElement.id = 'nearest-distance-display';
                 newElement.textContent = `Nearest: ${nearestDistance.toFixed(3)} meters (CREATED)`;
                 newElement.style.cssText = 'font-size: 1.2rem; font-weight: bold; text-align: center; margin: 0 0 10px 0; padding: 10px; background: #e8f5e8; border-radius: 8px; border: 2px solid #28a745; color: #155724; display: block; min-height: 40px;';
                 
                 // Insert after distance-display
                 const distanceDisplay = document.getElementById('distance-display');
                 if (distanceDisplay && distanceDisplay.nextSibling) {
                   measurementPanel.insertBefore(newElement, distanceDisplay.nextSibling);
                 } else {
                   measurementPanel.appendChild(newElement);
                 }
                 console.log('Created nearest-distance-display element');
               } else {
                 console.error('measurement-panel not found either!');
               }
             }
            
            if (measurementUI) {
              measurementUI.updateNearestDistance(nearestDistance);
            }
            
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
          if (pose && alva.getFramePoints) {
            const points3D = alva.getFramePoints();
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
                // Use 3D points directly as they are already in camera coordinates from getStereoFramePoints
                // No transformation needed since C++ backend sends camera coordinates
                
                // Project camera coordinates to 2D image coordinates using pinhole camera model
                if (point3D.z > 0.1) { // Only points in front of camera
                  const x = (point3D.x * fx / point3D.z) + cx;
                  const y = (point3D.y * fy / point3D.z) + cy;
                
                  // Only draw points that are in front of camera and within image bounds
                  if (x >= 0 && x < 752 && y >= 0 && y < 480) {
                    // Color based on depth (closer = brighter, farther = darker)
                    const depth = Math.min(point3D.z / 5.0, 1.0); // Use camera Z coordinate for depth
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
            }
          } else {
            // No fallback - only show triangulated 3D points
            // If no 3D points available, left frame shows only the camera feed
            console.log('No triangulated 3D points available - showing camera feed only');
          }

          // Render start and end markers in left frame (moved outside 3D points condition)
          if (arRulerSystem && pose) {
            // Get camera transform from pose for world-to-camera transformation
            const { position: cameraPosition, direction: cameraDirection } = arRulerSystem.getCameraTransform(pose);

            // Create camera quaternion from pose matrix with AlvaAR coordinate transformation
            const rotationMatrix = new THREE.Matrix4().fromArray(pose);
            const cameraQuaternion = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
            cameraQuaternion.set(-cameraQuaternion.x, cameraQuaternion.y, cameraQuaternion.z, cameraQuaternion.w);

            // Create world-to-camera transformation matrix (inverse of camera pose)
            const cameraInverseMatrix = new THREE.Matrix4();
            cameraInverseMatrix.compose(cameraPosition, cameraQuaternion, new THREE.Vector3(1, 1, 1)).invert();

            // Update 3D camera frustum visualization for pose debugging
            if (window.createCameraFrustum) {
              window.createCameraFrustum(cameraPosition, cameraQuaternion);
            }
            
            // Debug: Display camera pose information
            if (window.debugCounter % 60 === 0) { // Log every 60 frames (about once per second)
              console.log('=== CAMERA POSE DEBUG ===');
              console.log('Camera position (world):', cameraPosition);
              console.log('Camera direction (world):', cameraDirection);
              console.log('Pose matrix translation:', pose[12], pose[13], pose[14]);
              console.log('Camera quaternion:', cameraQuaternion);
            }

            // Get camera intrinsics for marker projection
            let fx = 525, fy = 525, cx = 320, cy = 240; // Default fallback values
            
            if (leftCameraIntrinsics) {
              fx = leftCameraIntrinsics.fx;
              fy = leftCameraIntrinsics.fy;
              cx = leftCameraIntrinsics.cx;
              cy = leftCameraIntrinsics.cy;
            }

            // Render start marker if it exists
            if (arRulerSystem.startPoint) {
              // Transform world coordinates to camera coordinates (reverse of C++ backend)
              // C++ backend does: pt_world = current_pose * pt_camera
              // Frontend does: pt_camera = current_pose.inverse() * pt_world
              const worldPoint = new THREE.Vector3(arRulerSystem.startPoint.x, arRulerSystem.startPoint.y, arRulerSystem.startPoint.z);
              const cameraPoint = worldPoint.clone().applyMatrix4(cameraInverseMatrix);

              // Project camera coordinates to 2D image coordinates using pinhole camera model
              if (cameraPoint.z > 0.1) { // Only points in front of camera
                const x = (cameraPoint.x * fx / cameraPoint.z) + cx;
                const y = (cameraPoint.y * fy / cameraPoint.z) + cy;
                
                // Only draw if within image bounds
                if (x >= 0 && x < 752 && y >= 0 && y < 480) {
                  // Draw green circle for start marker
                  ctx.fillStyle = '#00ff00';
                  ctx.beginPath();
                  ctx.arc(x, y, 8, 0, 2 * Math.PI);
                  ctx.fill();
                  
                  // Draw white border
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = 2;
                  ctx.stroke();
                }
              }
            }

            // Render end marker if it exists
            if (arRulerSystem.endPoint) {
              // Transform world coordinates to camera coordinates
              const worldPoint = new THREE.Vector3(arRulerSystem.endPoint.x, arRulerSystem.endPoint.y, arRulerSystem.endPoint.z);
              const cameraPoint = worldPoint.clone().applyMatrix4(cameraInverseMatrix);

              // Project camera coordinates to 2D image coordinates using pinhole camera model
              if (cameraPoint.z > 0.1) { // Only points in front of camera
                const x = (cameraPoint.x * fx / cameraPoint.z) + cx;
                const y = (cameraPoint.y * fy / cameraPoint.z) + cy;
                
                // Only draw if within image bounds
                if (x >= 0 && x < 752 && y >= 0 && y < 480) {
                  // Draw red circle for end marker
                  ctx.fillStyle = '#ff0000';
                  ctx.beginPath();
                  ctx.arc(x, y, 8, 0, 2 * Math.PI);
                  ctx.fill();
                  
                  // Draw white border
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = 2;
                  ctx.stroke();
                }
              }
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
      
      // Show the container and panels when application starts
      const container = document.getElementById('container');
      const measurementPanel = document.getElementById('measurement-panel');
      const visualizerPanel = document.getElementById('visualizer-panel');
      
      if (container) {
        container.style.display = 'block';
      }
      if (measurementPanel) {
        measurementPanel.style.display = 'flex';
      }
      if (visualizerPanel) {
        visualizerPanel.style.display = 'block';
      }
      
      demoStream();
    }, { once: true });
  }, splashFadeTime);
}

// Export the main function so it can be imported and called
export { main };
