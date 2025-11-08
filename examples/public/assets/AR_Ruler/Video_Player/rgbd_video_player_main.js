// Import all the necessary functions and classes
import { waitForEmscriptenModule, parseCalibrationYAML, MONOCULAR_SCALE_FACTOR } from '../rgbd_ar_ruler_script.js';
import { VideoPlayerSystem } from './rgbd_video_player_script.js';
import { VideoPlayerVisualizer, VideoPlayerUI } from './rgbd_video_player_classes.js';

// Mobile detection function
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
         (window.innerWidth <= 768 && window.innerHeight <= 1024);
}

// Enforce horizontal view for mobile
function enforceHorizontalView() {
  if (isMobileDevice()) {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(err => {
        console.log('Could not lock orientation:', err);
      });
    }
    
    const style = document.createElement('style');
    style.textContent = `
      @media screen and (orientation: portrait) {
        body::before {
          content: "Please rotate your device to landscape mode for the best experience";
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 20px;
          border-radius: 10px;
          z-index: 10000;
          text-align: center;
          font-size: 18px;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

// Global variables for video management
let mediaLeft, mediaRight;
let sceneVisualizer;

// Panel visibility state
let panelsVisible = !isMobileDevice();

// VIDEO_CONFIG for stereo video selection
const VIDEO_CONFIG = {
  '1. light_desk_HF_40cm': {
    leftFile: 'Indoor_Videos/Desk-left-light-40cm.mp4',
    rightFile: 'Indoor_Videos/Desk-right-light-40cm.mp4',
    displayName: '1. light_desk_HF_40cm'
  },
  '2. dark_desk_HF_40cm': {
    leftFile: 'Indoor_Videos/Desk-left-dark-40cm.mp4',
    rightFile: 'Indoor_Videos/Desk-right-dark-40cm.mp4',
    displayName: '2. dark_desk_HF_40cm'
  },
  '3. light_storeroom_HF_35cm': {
    leftFile: 'Indoor_Videos/Storeroom_left_light_35cm.mp4',
    rightFile: 'Indoor_Videos/Storeroom_right_light_35cm.mp4',
    displayName: '3. light_storeroom_HF_35cm'
  },
  '4. dark_storeroom_HF_35cm': {
    leftFile: 'Indoor_Videos/Storeroom_left_dark_35cm.mp4',
    rightFile: 'Indoor_Videos/Storeroom_right_dark_35cm.mp4',
    displayName: '4. dark_storeroom_HF_35cm'
  },
  '5. light_corridor_LF_35cm': {
    leftFile: 'Indoor_Videos/corridor_left_light_35cm.mp4',
    rightFile: 'Indoor_Videos/corridor_right_light_35cm.mp4',
    displayName: '5. light_corridor_LF_35cm'
  },
  '6. dark_corridor_LF_35cm': {
    leftFile: 'Indoor_Videos/corridor_left_dark_35cm.mp4',
    rightFile: 'Indoor_Videos/corridor_right_dark_35cm.mp4',
    displayName: '6. dark_corridor_LF_35cm'
  },
  '7. light_balcony_LF_35cm': {
    leftFile: 'Indoor_Videos/Balcony_left_light_35cm.mp4',
    rightFile: 'Indoor_Videos/Balcony_right_light_35cm.mp4',
    displayName: '7. light_balcony_LF_35cm'
  },
  '8. dark_balcony_LF_35cm': {
    leftFile: 'Indoor_Videos/Balcony_left_dark_35cm.mp4',
    rightFile: 'Indoor_Videos/Balcony_right_dark_35cm.mp4',
    displayName: '8. dark_balcony_LF_35cm'
  },
  '9. light_walkway_HF_150cm': {
    leftFile: 'Outdoor_Videos/Walkway_left_light_150cm.mp4',
    rightFile: 'Outdoor_Videos/Walkway_right_light_150cm.mp4',
    displayName: '9. light_walkway_HF_150cm'
  },
  '10. dark_walkway_HF_150cm': {
    leftFile: 'Outdoor_Videos/Walkway_left_dark_150cm.mp4',
    rightFile: 'Outdoor_Videos/Walkway_right_dark_150cm.mp4',
    displayName: '10. dark_walkway_HF_150cm'
  },
  '11. light_pillar_HF_150cm': {
    leftFile: 'Outdoor_Videos/Pillar_left_light_150cm.mp4',
    rightFile: 'Outdoor_Videos/Pillar_right_light_150cm.mp4',
    displayName: '11. light_pillar_HF_150cm'
  },
  '12. dark_pillar_HF_150cm': {
    leftFile: 'Outdoor_Videos/Pillar_left_dark_150cm.mp4',
    rightFile: 'Outdoor_Videos/Pillar_right_dark_150cm.mp4',
    displayName: '12. dark_pillar_HF_150cm'
  },
  '13. light_alley_LF_150cm': {
    leftFile: 'Outdoor_Videos/Alley_left_light_150cm.mp4',
    rightFile: 'Outdoor_Videos/Alley_right_light_150cm.mp4',
    displayName: '13. light_alley_LF_150cm'
  },
  '14. dark_alley_LF_150cm': {
    leftFile: 'Outdoor_Videos/Alley_left_dark_150cm.mp4',
    rightFile: 'Outdoor_Videos/Alley_right_dark_150cm.mp4',
    displayName: '14. dark_alley_LF_150cm'
  },
  '15. light_carpark_LF_66cm': {
    leftFile: 'Outdoor_Videos/Carpark_left_light_66cm.mp4',
    rightFile: 'Outdoor_Videos/Carpark_right_light_66cm.mp4',
    displayName: '15. light_carpark_LF_66cm'
  },
  '16. dark_carpark_LF_66cm': {
    leftFile: 'Outdoor_Videos/Carpark_left_dark_66cm.mp4',
    rightFile: 'Outdoor_Videos/Carpark_right_dark_66cm.mp4',
    displayName: '16. dark_carpark_LF_66cm'
  }
};

// Function to load video by type
async function loadVideoByType(videoType, Video) {
  console.log('🎬 Loading video type:', videoType);
  
  const config = VIDEO_CONFIG[videoType];
  if (!config) {
    console.warn('Unknown video type:', videoType);
    return;
  }
  
  const leftVideoPath = `./assets/AR_Ruler/${config.leftFile}`;
  const rightVideoPath = `./assets/AR_Ruler/${config.rightFile}`;
  
  try {
    mediaLeft = await Video.Initialize(leftVideoPath);
    mediaRight = await Video.Initialize(rightVideoPath);
    
    mediaLeft.el.play();
    mediaLeft.el.loop = true;
    mediaRight.el.play();
    mediaRight.el.loop = true;
    
    console.log('✅ Videos loaded successfully');
  } catch (error) {
    console.error('❌ Error loading videos:', error);
  }
}

async function main(Module, Stats, ARSimpleView, ARSimpleMap, Video, THREE, isLiveMode = false) {
  enforceHorizontalView();
  
  const $container = document.getElementById('container');
  const $visualizerContainer = document.getElementById('visualizer-panel');
  const $view = document.createElement('div');
  const $canvas = document.createElement('canvas');
  const $overlay = document.getElementById('overlay');
  const $start = document.getElementById('start_button');
  const $splash = document.getElementById('splash');
  const splashFadeTime = 800;

  // Set up panel toggle
  const togglePanelsBtn = document.getElementById('toggle-panels');
  if (togglePanelsBtn) {
    if (panelsVisible) {
      togglePanelsBtn.textContent = '👁️';
      togglePanelsBtn.title = 'Hide Panels';
    } else {
      togglePanelsBtn.textContent = '❌';
      togglePanelsBtn.classList.add('panels-hidden');
      togglePanelsBtn.title = 'Show Panels';
    }
    
    togglePanelsBtn.addEventListener('click', () => {
      panelsVisible = !panelsVisible;
      const measurementPanel = document.getElementById('measurement-panel');
      const visualizerPanel = document.getElementById('visualizer-panel');
      
      if (panelsVisible) {
        if (measurementPanel) measurementPanel.style.display = 'flex';
        if (visualizerPanel) visualizerPanel.style.display = 'block';
        togglePanelsBtn.textContent = '👁️';
        togglePanelsBtn.classList.remove('panels-hidden');
      } else {
        if (measurementPanel) measurementPanel.style.display = 'none';
        if (visualizerPanel) visualizerPanel.style.display = 'none';
        togglePanelsBtn.textContent = '❌';
        togglePanelsBtn.classList.add('panels-hidden');
      }
    });
  }

  let alva, view, stats;
  let videoPlayerSystem, visualizer, videoPlayerUI;
  let latestPose = null;
  let firstFrame = true;
  let showRightCamera = false;
  let image_width = 640;
  let image_height = 480;
  
  // WebSocket frame bitmaps for live mode
  let latestFrameBitmapLeft = null;
  let latestFrameBitmapRight = null;

  // WebSocket error display functions
  function showWebSocketError(message) {
    const existingError = document.getElementById('websocket-error');
    if (existingError) {
      existingError.remove();
    }
    
    const errorDiv = document.createElement('div');
    errorDiv.id = 'websocket-error';
    errorDiv.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(255, 0, 0, 0.9);
      color: white;
      padding: 15px 20px;
      border-radius: 5px;
      z-index: 10000;
      font-family: Arial, sans-serif;
      font-size: 14px;
      max-width: 80%;
      text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
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
    // Resolve WebSocket URL - default to localhost:8765
    let wsUrl = "ws://localhost:8765";
    wsUrl = wsUrl.trim();
    
    // Normalize scheme: preserve ws/wss, convert http(s) -> ws://, default to ws://
    if (wsUrl.startsWith('ws://') || wsUrl.startsWith('wss://')) {
      // keep as-is
    } else if (wsUrl.startsWith('https://')) {
      wsUrl = 'wss://' + wsUrl.slice('https://'.length);
    } else if (wsUrl.startsWith('http://')) {
      wsUrl = 'ws://' + wsUrl.slice('http://'.length);
    } else {
      wsUrl = 'ws://' + wsUrl;
    }

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      console.log("✅ Connected to WebSocket video stream:", wsUrl);
      hideWebSocketError();
    };
    ws.onerror = err => {
      console.error("❌ WebSocket error:", err);
      showWebSocketError(`Failed to connect to live camera stream at ${wsUrl}.`);
    };
    ws.onclose = () => {
      console.warn("⚠️ WebSocket connection closed:", wsUrl);
      showWebSocketError(`Live camera connection to ${wsUrl} lost. Attempting to reconnect...`);
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
    
    // Fetch and set calibration YAML
    const yamlResponse = await fetch('./assets/d345i_640x480.yaml');
    const yamlText = await yamlResponse.text();
    if (typeof ModuleInstance.setStereoCalibrationYAML === 'function') {
      ModuleInstance.setStereoCalibrationYAML(yamlText);
    }
    
    // Parse calibration data
    let leftCameraIntrinsics = null;
    try {
      const calibrationData = parseCalibrationYAML(yamlText);
      leftCameraIntrinsics = calibrationData.intrinsics;
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
          const buf = ModuleInstance._malloc(n * 4 * 3);
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
      const storedVideoType = localStorage.getItem('selectedVideoType');
      const defaultKey = Object.keys(VIDEO_CONFIG)[0];
      const videoTypeToLoad = (storedVideoType && VIDEO_CONFIG[storedVideoType]) ? storedVideoType : defaultKey;
      await loadVideoByType(videoTypeToLoad, Video);
    }

    // Set up view overlay
    $view.style.position = 'absolute';
    $view.style.left = '0px';
    $view.style.top = '0px';
    $view.style.width = '640px';
    $view.style.height = '480px';
    $view.style.zIndex = '10';
    
    // Initialize 3D Scene Visualizer
    sceneVisualizer = new ARSimpleMap($visualizerContainer, 400, 480);
    const camRenderer = new ARSimpleView($view, 640, 480, sceneVisualizer);
    view = camRenderer;
    
    // Initialize Video Player system
    videoPlayerSystem = new VideoPlayerSystem();
    visualizer = new VideoPlayerVisualizer(view.scene, sceneVisualizer);
    videoPlayerUI = new VideoPlayerUI();
    
    if (leftCameraIntrinsics) {
      if (typeof view.setCameraIntrinsics === 'function') {
        view.setCameraIntrinsics(leftCameraIntrinsics);
      }
    }
    
    videoPlayerSystem.initialize(visualizer, videoPlayerUI, view.camera, alva);
    
    // Set up UI callbacks
    if (videoPlayerUI.placeVideoBtn) {
      videoPlayerUI.placeVideoBtn.addEventListener('click', () => {
        if (latestPose) {
          const videoURLInput = document.getElementById('video-url-input');
          const videoURL = videoURLInput ? videoURLInput.value.trim() : 'https://www.youtube.com/watch?v=DszTO3PPyNQ';
          videoPlayerSystem.placeVideo(latestPose, videoURL);
        }
      });
    }
    
    if (videoPlayerUI.resetVideoBtn) {
      videoPlayerUI.resetVideoBtn.addEventListener('click', () => {
        videoPlayerSystem.resetVideo();
      });
    }
    
    if (videoPlayerUI.videoDistanceSlider) {
      videoPlayerUI.videoDistanceSlider.addEventListener('input', () => {
        if (latestPose && videoPlayerSystem.videoPosition) {
          videoPlayerSystem.updateVideoPosition(latestPose);
        }
      });
    }
    
    // Add toggle button for right camera
    const toggleRightCameraBtn = document.getElementById('toggle-right-camera');
    if (toggleRightCameraBtn) {
      toggleRightCameraBtn.textContent = 'Show Right Camera';
      toggleRightCameraBtn.addEventListener('click', () => {
        showRightCamera = !showRightCamera;
        toggleRightCameraBtn.textContent = showRightCamera ? 'Hide Right Camera' : 'Show Right Camera';
      });
    }
    
    // Add coordinate system indicator
    const originAxes = new THREE.AxesHelper(0.25);
    originAxes.position.set(0, 0, 0);
    sceneVisualizer.scene.add(originAxes);
    
    // Add ambient lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    sceneVisualizer.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    sceneVisualizer.scene.add(directionalLight);
    
    // Initialize feature points array for point cloud visualization
    sceneVisualizer.featurePoints = [];
    sceneVisualizer.featureGeometry = null;
    sceneVisualizer.featureMaterial = null;
    
    // Function to visualize 3D feature points from SLAM (orange point clouds)
    function visualizeFeaturePoints() {
      if (!sceneVisualizer) {
        console.log('visualizeFeaturePoints: sceneVisualizer not available');
        return;
      }
      if (!alva) {
        console.log('visualizeFeaturePoints: alva not available');
        return;
      }
      if (!alva.getFramePoints3D) {
        console.log('visualizeFeaturePoints: alva.getFramePoints3D not available');
        return;
      }
      
      // Get 3D points from SLAM system
      const points3D = alva.getFramePoints3D();
      if (!points3D || points3D.length === 0) {
        // Only log occasionally to avoid spam
        if (window.featurePointDebugCounter === undefined) window.featurePointDebugCounter = 0;
        window.featurePointDebugCounter++;
        if (window.featurePointDebugCounter % 120 === 0) {
          console.log('visualizeFeaturePoints: No 3D points available');
        }
        return;
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
      if (!sceneVisualizer.featureGeometry) {
        sceneVisualizer.featureGeometry = new THREE.SphereGeometry(0.004 * MONOCULAR_SCALE_FACTOR, 8, 8);
      }
      if (!sceneVisualizer.featureMaterial) {
        sceneVisualizer.featureMaterial = new THREE.MeshBasicMaterial({ 
          color: 0xff6600, // Orange color
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
        sphere.position.set(point3D.x, -point3D.y, -point3D.z);
        
        sceneVisualizer.scene.add(sphere);
        sceneVisualizer.featurePoints.push(sphere);
      }
      
      // Debug: Log success (only occasionally to avoid spam)
      if (window.featurePointDebugCounter === undefined) window.featurePointDebugCounter = 0;
      window.featurePointDebugCounter++;
    }

    stats = Stats;
    stats.add('total');
    stats.add('video');
    stats.add('slam');

    $container.appendChild($canvas);
    $container.appendChild($view);
    document.body.appendChild(stats.el);

    // Add click handler for left frame overlay
    const leftFrameOverlay = document.getElementById('left-frame-click-overlay');
    if (leftFrameOverlay) {
      leftFrameOverlay.addEventListener('click', (event) => {
        event.stopPropagation();
        
        if (!latestPose) {
          console.log('No valid pose available for video placement');
          return;
        }
        
        const videoURLInput = document.getElementById('video-url-input');
        const videoURL = videoURLInput ? videoURLInput.value.trim() : 'https://www.youtube.com/watch?v=DszTO3PPyNQ';
        
        console.log('Left frame clicked - placing video at:', videoURL);
        videoPlayerSystem.placeVideo(latestPose, videoURL);
      });
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
      $container.style.width = width + 'px';
      
      const ctx = $canvas.getContext('2d');
      ctx.clearRect(0, 0, $canvas.width, $canvas.height);

      let frameLeft = null;
      let frameRight = null;
      let pose = null;

      if (!document.hidden) {
        if (isLiveMode) {
          // Live mode: Convert bitmaps to ImageData
          if (latestFrameBitmapLeft && latestFrameBitmapRight) {
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
          // Video mode: Get frames from video elements
          frameLeft = mediaLeft.getImageData();
          frameRight = mediaRight.getImageData();
        }

        if (!frameLeft || !frameRight || !frameLeft.data.length || !frameRight.data.length) {
          requestAnimationFrame(render);
          return;
        }

        if (frameLeft && frameRight) {
          stats.start('video');
          
          if (isLiveMode && latestFrameBitmapLeft) {
            // Live mode: Draw bitmaps directly
            ctx.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
            if (showRightCamera && latestFrameBitmapRight) {
              ctx.drawImage(latestFrameBitmapRight, image_width + spacing, 0, image_width, image_height);
            }
          } else {
            // Video mode: Draw ImageData
            ctx.putImageData(frameLeft, 0, 0);
            if (showRightCamera) {
              ctx.putImageData(frameRight, image_width + spacing, 0);
            }
          }
          
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(0, 0, 170, 25);
          ctx.fillStyle = "white";
          ctx.font = "16px Helvetica";
          ctx.fillText("Left Camera (Stereo)", 10, 18);

          if (showRightCamera) {
            ctx.save();
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillRect(640, 0, 120, 25);
            ctx.fillStyle = "white";
            ctx.fillText("Right Camera", 650, 18);
            ctx.restore();
          }
          
          stats.stop('video');
          stats.start('slam');
          
          if (firstFrame) {
            alva.reset();
            firstFrame = false;
          }
          pose = alva.findStereoCameraPose(frameLeft, frameRight);
          stats.stop('slam');
          
          if (pose) {
            latestPose = pose;
            
            // Apply MONOCULAR_SCALE_FACTOR to pose translation
            const scaledPose = [...pose];
            if (MONOCULAR_SCALE_FACTOR !== 1.0) {
              scaledPose[12] *= MONOCULAR_SCALE_FACTOR;
              scaledPose[13] *= MONOCULAR_SCALE_FACTOR;
              scaledPose[14] *= MONOCULAR_SCALE_FACTOR;
            }
            
            view.updateCameraPose(scaledPose);
            
            // Update 3D Scene Visualizer
            if (MONOCULAR_SCALE_FACTOR !== 1.0) {
              const visualizerPose = [...pose];
              visualizerPose[12] *= MONOCULAR_SCALE_FACTOR;
              visualizerPose[13] *= MONOCULAR_SCALE_FACTOR;
              visualizerPose[14] *= MONOCULAR_SCALE_FACTOR;
              view.updateCameraPose(visualizerPose);
            } else {
              view.updateCameraPose(pose);
            }
            
            // Render CSS3D scene for YouTube videos (needs to be called after camera update)
            // Always render CSS3D if it exists, not just when pose is valid
            if (visualizer && visualizer.css3DRenderer && visualizer.css3DScene) {
              visualizer.renderCSS3D(view.camera);
            }
            
            // Visualize 3D feature points (orange point clouds)
            visualizeFeaturePoints();
          } else {
            view.lostCamera();
            // Still try to visualize feature points even if pose is not found
            // This helps show points during tracking loss
            visualizeFeaturePoints();
          }

          // Draw 3D stereo frame points projected onto left camera
          if (pose && alva.getFramePoints) {
            const points3D = alva.getFramePoints();
            if (points3D && points3D.length > 0) {
              let fx = 525, fy = 525, cx = 320, cy = 240;
              
              if (leftCameraIntrinsics) {
                fx = leftCameraIntrinsics.fx;
                fy = leftCameraIntrinsics.fy;
                cx = leftCameraIntrinsics.cx;
                cy = leftCameraIntrinsics.cy;
              }
              
              for (const point3D of points3D) {
                if (point3D.z > 0.1) {
                  const x = (point3D.x * fx / point3D.z) + cx;
                  const y = (point3D.y * fy / point3D.z) + cy;
                
                  if (x >= 0 && x < 640 && y >= 0 && y < 480) {
                    const depth = Math.min(point3D.z / 5.0, 1.0);
                    const intensity = Math.floor(255 * (1.0 - depth));
                    
                    if (point3D.z < 1.0) {
                      ctx.fillStyle = `rgb(255, ${intensity}, ${intensity})`;
                    } else if (point3D.z < 2.0) {
                      ctx.fillStyle = `rgb(${intensity}, 255, ${intensity})`;
                    } else {
                      ctx.fillStyle = `rgb(${intensity}, ${intensity}, 255)`;
                    }
                    
                    const size = Math.max(1, Math.floor(4 * (1.0 - depth)));
                    ctx.fillRect(x - size/2, y - size/2, size, size);
                  }
                }
              }
            }
          }
        }
      }
      
      stats.stop('total');
      stats.render();
      requestAnimationFrame(render);
    }
    render();
  }

  // Set initial panel visibility
  const measurementPanel = document.getElementById('measurement-panel');
  const visualizerPanel = document.getElementById('visualizer-panel');
  if (measurementPanel) {
    measurementPanel.style.display = panelsVisible ? 'flex' : 'none';
  }
  if (visualizerPanel) {
    visualizerPanel.style.display = panelsVisible ? 'block' : 'none';
  }

  setTimeout(() => {
    $splash.remove();
    $start.addEventListener('click', () => {
      $overlay.remove();
      
      const container = document.getElementById('container');
      const measurementPanel = document.getElementById('measurement-panel');
      const visualizerPanel = document.getElementById('visualizer-panel');
      
      if (container) container.style.display = 'block';
      if (measurementPanel) measurementPanel.style.display = panelsVisible ? 'flex' : 'none';
      if (visualizerPanel) visualizerPanel.style.display = panelsVisible ? 'block' : 'none';
      
      demoStream();
    }, { once: true });
  }, splashFadeTime);
}

export { main };

