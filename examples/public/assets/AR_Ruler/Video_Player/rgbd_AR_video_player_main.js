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

// Function to load video by type - MODIFIED to unmute videos for sound
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
    
    // Unmute videos to enable sound
    mediaLeft.el.muted = false;
    mediaRight.el.muted = false;
    
    // Ensure videos are ready before playing
    await Promise.all([
      new Promise((resolve) => {
        if (mediaLeft.el.readyState >= 2) {
          resolve();
        } else {
          mediaLeft.el.addEventListener('canplay', resolve, { once: true });
        }
      }),
      new Promise((resolve) => {
        if (mediaRight.el.readyState >= 2) {
          resolve();
        } else {
          mediaRight.el.addEventListener('canplay', resolve, { once: true });
        }
      })
    ]);
    
    mediaLeft.el.play().catch(e => console.warn('Left video play failed:', e));
    mediaLeft.el.loop = true;
    mediaRight.el.play().catch(e => console.warn('Right video play failed:', e));
    mediaRight.el.loop = true;
    
    console.log('✅ Videos loaded successfully with sound enabled');
  } catch (error) {
    console.error('❌ Error loading videos:', error);
  }
}

// GLSL Fragment Shader for Pincushion (Barrel) Distortion - from ARTest.html
const distortionFragmentShader = `
  uniform sampler2D videoTexture;
  varying vec2 vUv;
  
  // Adjust these coefficients (k1, k2) to change the distortion power.
  const float k1 = 0.28; 
  const float k2 = 0.35;

  void main() {
    // 1. Normalize UV coordinates from [0, 1] to [-1, 1]
    vec2 uv = vUv * 2.0 - 1.0;
    
    // 2. Calculate the distance squared from the center (radius^2)
    float r2 = uv.x * uv.x + uv.y * uv.y;
    
    // 3. Apply the radial distortion formula (Pincushion effect)
    float distortion_factor = 1.0 + k1 * r2 + k2 * r2 * r2;
    
    // 4. Apply distortion to the normalized coordinates
    vec2 distorted_uv = uv * distortion_factor;
    
    // 5. Convert back to texture coordinates [0, 1]
    vec2 final_uv = distorted_uv * 0.5 + 0.5;

    // 6. Check if the coordinate is outside the valid range (creates the vignette effect)
    if (final_uv.x < 0.0 || final_uv.x > 1.0 || final_uv.y < 0.0 || final_uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Render black outside the distorted circle
    } else {
      // 7. Sample the video texture at the new distorted coordinates
      gl_FragColor = texture2D(videoTexture, final_uv);
    }
  }
`;

async function main(Module, Stats, ARSimpleView, ARSimpleMap, Video, THREE, isLiveMode = false) {
  enforceHorizontalView();
  
  const $container = document.getElementById('container');
  const $visualizerContainer = document.getElementById('visualizer-panel');
  const $view = document.createElement('div');
  const $overlay = document.getElementById('overlay');
  const $start = document.getElementById('start_button');
  const $splash = document.getElementById('splash');
  const splashFadeTime = 800;
  
  // Set container height to actual viewport height (excludes browser chrome) immediately
  // Also position panels below the fixed container
  const updateContainerAndPanels = () => {
    const availableHeight = window.innerHeight;
    console.log('🔍 [DEBUG] updateContainerAndPanels - availableHeight:', availableHeight);
    
    if ($container) {
      $container.style.height = availableHeight + 'px';
      console.log('✅ [DEBUG] Container height set to:', availableHeight);
    } else {
      console.error('❌ [DEBUG] Container not found!');
    }
    
    const $panelsContainer = document.getElementById('panels-container');
    if ($panelsContainer) {
      console.log('✅ [DEBUG] Panels container found');
      console.log('🔍 [DEBUG] Panels container before update:', {
        display: window.getComputedStyle($panelsContainer).display,
        visibility: window.getComputedStyle($panelsContainer).visibility,
        opacity: window.getComputedStyle($panelsContainer).opacity,
        marginTop: window.getComputedStyle($panelsContainer).marginTop,
        offsetHeight: $panelsContainer.offsetHeight,
        offsetTop: $panelsContainer.offsetTop,
        classList: Array.from($panelsContainer.classList)
      });
      
      // Position panels below the fixed container
      $panelsContainer.style.marginTop = availableHeight + 'px';
      $panelsContainer.style.minHeight = 'auto';
      
      console.log('🔍 [DEBUG] Panels container after update:', {
        display: window.getComputedStyle($panelsContainer).display,
        visibility: window.getComputedStyle($panelsContainer).visibility,
        opacity: window.getComputedStyle($panelsContainer).opacity,
        marginTop: window.getComputedStyle($panelsContainer).marginTop,
        marginTopSet: $panelsContainer.style.marginTop,
        offsetHeight: $panelsContainer.offsetHeight,
        offsetTop: $panelsContainer.offsetTop
      });
      
      // Check child panels
      const measurementPanel = document.getElementById('measurement-panel');
      const visualizerPanel = document.getElementById('visualizer-panel');
      console.log('🔍 [DEBUG] Child panels:', {
        measurementPanel: {
          exists: !!measurementPanel,
          display: measurementPanel ? window.getComputedStyle(measurementPanel).display : 'N/A',
          offsetHeight: measurementPanel ? measurementPanel.offsetHeight : 'N/A'
        },
        visualizerPanel: {
          exists: !!visualizerPanel,
          display: visualizerPanel ? window.getComputedStyle(visualizerPanel).display : 'N/A',
          offsetHeight: visualizerPanel ? visualizerPanel.offsetHeight : 'N/A'
        }
      });
      
      // Update body min-height after a brief delay to allow panels to render
      setTimeout(() => {
        const panelsHeight = $panelsContainer.offsetHeight || 500; // fallback to 500px
        document.body.style.minHeight = (availableHeight + panelsHeight + 40) + 'px'; // +40 for padding
        console.log('🔍 [DEBUG] Body min-height set to:', (availableHeight + panelsHeight + 40), 'px');
        console.log('🔍 [DEBUG] Final panels container state:', {
          display: window.getComputedStyle($panelsContainer).display,
          marginTop: window.getComputedStyle($panelsContainer).marginTop,
          offsetHeight: $panelsContainer.offsetHeight,
          scrollHeight: $panelsContainer.scrollHeight,
          clientHeight: $panelsContainer.clientHeight
        });
      }, 100);
    } else {
      console.error('❌ [DEBUG] Panels container not found in DOM!');
      console.log('🔍 [DEBUG] Available elements:', {
        mainContainer: !!document.getElementById('main-container'),
        container: !!document.getElementById('container'),
        panelsContainer: !!document.getElementById('panels-container'),
        measurementPanel: !!document.getElementById('measurement-panel'),
        visualizerPanel: !!document.getElementById('visualizer-panel')
      });
    }
  };
  
  console.log('🔍 [DEBUG] Initial panelsVisible:', panelsVisible);
  updateContainerAndPanels();
  
  // Update on window resize
  window.addEventListener('resize', () => {
    console.log('🔍 [DEBUG] Window resized');
    updateContainerAndPanels();
  });

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
      const panelsContainer = document.getElementById('panels-container');
      const measurementPanel = document.getElementById('measurement-panel');
      const visualizerPanel = document.getElementById('visualizer-panel');
      
      if (panelsVisible) {
        if (panelsContainer) {
          panelsContainer.classList.remove('panels-hidden');
          panelsContainer.style.display = '';
          panelsContainer.style.visibility = '';
          panelsContainer.style.opacity = '';
        }
        if (measurementPanel) measurementPanel.style.display = 'flex';
        if (visualizerPanel) visualizerPanel.style.display = 'block';
        togglePanelsBtn.textContent = '👁️';
        togglePanelsBtn.classList.remove('panels-hidden');
      } else {
        if (panelsContainer) {
          panelsContainer.classList.add('panels-hidden');
        }
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

  // Three.js AR rendering setup
  let renderer, sceneLeft, sceneRight, cameraLeft, cameraRight;
  let videoTextureLeft, videoTextureRight;
  let meshLeft, meshRight;
  
  // Composite canvases: video + AR overlays (undistorted) - these will be distorted for display
  let compositeCanvasLeft, compositeCanvasRight;
  let compositeCtxLeft, compositeCtxRight;
  
  // Separate canvases for undistorted AR processing (not displayed, only for SLAM)
  let processingCanvasLeft, processingCanvasRight;
  let processingCtxLeft, processingCtxRight;
  
  // Temporary canvas for capturing AR overlay from ARSimpleView
  let arOverlayCanvasLeft, arOverlayCanvasRight;

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
    let wsUrl = "ws://localhost:8765";
    wsUrl = wsUrl.trim();
    
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

  // Initialize Three.js AR renderer with distortion shader
  function initARRenderer() {
    const initialWidth = window.innerWidth;
    const initialHeight = window.innerHeight;
    
    // Set container height to actual viewport height (excludes browser chrome)
    // Use a more reliable method that accounts for browser UI
    const updateContainerHeight = () => {
      const $container = document.getElementById('container');
      const $panelsContainer = document.getElementById('panels-container');
      if ($container) {
        // Use window.innerHeight which excludes browser chrome
        const availableHeight = window.innerHeight;
        $container.style.height = availableHeight + 'px';
        // Also update renderer size
        if (renderer) {
          renderer.setSize(window.innerWidth, availableHeight);
        }
        // Update panels container position to be below the fixed container
        if ($panelsContainer) {
          $panelsContainer.style.marginTop = availableHeight + 'px';
          // Update body min-height
          setTimeout(() => {
            const panelsHeight = $panelsContainer.offsetHeight || 500;
            document.body.style.minHeight = (availableHeight + panelsHeight + 40) + 'px';
          }, 100);
        }
      }
    };
    
    // Update immediately and on resize
    updateContainerHeight();
    window.addEventListener('resize', updateContainerHeight);
    
    // Create the renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(initialWidth, initialHeight);
    renderer.autoClear = false;
    $container.appendChild(renderer.domElement);
    
    // Create separate scenes for left and right eyes
    sceneLeft = new THREE.Scene();
    sceneRight = new THREE.Scene();
    
    // Create the cameras
    const aspect = initialWidth / initialHeight;
    const orthoSize = 1;
    
    cameraLeft = new THREE.OrthographicCamera(-aspect * orthoSize, aspect * orthoSize, orthoSize, -orthoSize, 0.1, 100);
    cameraRight = new THREE.OrthographicCamera(-aspect * orthoSize, aspect * orthoSize, orthoSize, -orthoSize, 0.1, 100);
    
    cameraLeft.position.z = 1;
    cameraRight.position.z = 1;

    // Create composite canvases: video + AR overlays (undistorted) - will be distorted for display
    compositeCanvasLeft = document.createElement('canvas');
    compositeCanvasLeft.width = image_width;
    compositeCanvasLeft.height = image_height;
    compositeCtxLeft = compositeCanvasLeft.getContext('2d');
    
    compositeCanvasRight = document.createElement('canvas');
    compositeCanvasRight.width = image_width;
    compositeCanvasRight.height = image_height;
    compositeCtxRight = compositeCanvasRight.getContext('2d');
    
    // Create separate canvases for undistorted AR processing (not displayed, only for SLAM)
    processingCanvasLeft = document.createElement('canvas');
    processingCanvasLeft.width = image_width;
    processingCanvasLeft.height = image_height;
    processingCtxLeft = processingCanvasLeft.getContext('2d');
    
    processingCanvasRight = document.createElement('canvas');
    processingCanvasRight.width = image_width;
    processingCanvasRight.height = image_height;
    processingCtxRight = processingCanvasRight.getContext('2d');
    
    // Create canvases for capturing AR overlay from ARSimpleView
    arOverlayCanvasLeft = document.createElement('canvas');
    arOverlayCanvasLeft.width = image_width;
    arOverlayCanvasLeft.height = image_height;
    
    arOverlayCanvasRight = document.createElement('canvas');
    arOverlayCanvasRight.width = image_width;
    arOverlayCanvasRight.height = image_height;

    // Create video textures from composite canvases (video + AR overlays, undistorted)
    videoTextureLeft = new THREE.CanvasTexture(compositeCanvasLeft);
    videoTextureLeft.minFilter = THREE.LinearFilter;
    videoTextureLeft.magFilter = THREE.LinearFilter;
    videoTextureLeft.format = THREE.RGBFormat;
    
    videoTextureRight = new THREE.CanvasTexture(compositeCanvasRight);
    videoTextureRight.minFilter = THREE.LinearFilter;
    videoTextureRight.magFilter = THREE.LinearFilter;
    videoTextureRight.format = THREE.RGBFormat;

    // Create Material with Distortion Shader
    const materialLeft = new THREE.ShaderMaterial({
      uniforms: {
        videoTexture: { value: videoTextureLeft }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: distortionFragmentShader
    });

    const materialRight = new THREE.ShaderMaterial({
      uniforms: {
        videoTexture: { value: videoTextureRight }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: distortionFragmentShader
    });

    // Create Geometry (planes to apply the video textures to)
    const geometry = new THREE.PlaneGeometry(2 * aspect * orthoSize, 2 * orthoSize);
    
    // Create the Meshes and add to respective scenes
    meshLeft = new THREE.Mesh(geometry, materialLeft);
    meshRight = new THREE.Mesh(geometry, materialRight);
    sceneLeft.add(meshLeft);
    sceneRight.add(meshRight);

    window.addEventListener('resize', onWindowResize, false);
  }

  function onWindowResize() {
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;
    
    // Update container height to actual viewport height (excludes browser chrome)
    const $container = document.getElementById('container');
    const $panelsContainer = document.getElementById('panels-container');
    if ($container) {
      $container.style.height = newHeight + 'px';
    }
    if ($panelsContainer) {
      $panelsContainer.style.marginTop = newHeight + 'px';
      // Update body min-height
      setTimeout(() => {
        const panelsHeight = $panelsContainer.offsetHeight || 500;
        document.body.style.minHeight = (newHeight + panelsHeight + 40) + 'px';
      }, 100);
    }
    
    renderer.setSize(newWidth, newHeight);
    
    const aspect = newWidth / newHeight;
    const orthoSize = 1;

    // Update Orthographic Cameras
    cameraLeft.left = -aspect * orthoSize;
    cameraLeft.right = aspect * orthoSize;
    cameraLeft.top = orthoSize;
    cameraLeft.bottom = -orthoSize;
    cameraLeft.updateProjectionMatrix();

    cameraRight.left = -aspect * orthoSize;
    cameraRight.right = aspect * orthoSize;
    cameraRight.top = orthoSize;
    cameraRight.bottom = -orthoSize;
    cameraRight.updateProjectionMatrix();

    // Replace Meshes to match the new aspect ratio
    sceneLeft.remove(meshLeft);
    sceneRight.remove(meshRight);
    meshLeft.geometry.dispose();
    meshRight.geometry.dispose();
    
    const geometry = new THREE.PlaneGeometry(2 * aspect * orthoSize, 2 * orthoSize);
    meshLeft = new THREE.Mesh(geometry, meshLeft.material);
    meshRight = new THREE.Mesh(geometry, meshRight.material);
    sceneLeft.add(meshLeft);
    sceneRight.add(meshRight);
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
          const buf = ModuleInstance._malloc(n * 4 * 3);
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

    // Initialize AR renderer
    initARRenderer();

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

    // Set up view overlay - hidden, used only for AR rendering (will be composited)
    $view.style.position = 'absolute';
    $view.style.left = '-9999px'; // Hide off-screen
    $view.style.top = '0px';
    $view.style.width = '640px';
    $view.style.height = '480px';
    $view.style.zIndex = '10';
    $view.style.visibility = 'hidden';
    
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
          color: 0xff6600,
          transparent: true,
          opacity: 0.8
        });
      }
      
      // Create new feature points (limit to avoid performance issues)
      const maxPoints = Math.min(points3D.length, 200);
      for (let i = 0; i < maxPoints; i++) {
        const point3D = points3D[i];
        
        const sphere = new THREE.Mesh(sceneVisualizer.featureGeometry, sceneVisualizer.featureMaterial);
        sphere.position.set(point3D.x, -point3D.y, -point3D.z);
        
        sceneVisualizer.scene.add(sphere);
        sceneVisualizer.featurePoints.push(sphere);
      }
      
      if (window.featurePointDebugCounter === undefined) window.featurePointDebugCounter = 0;
      window.featurePointDebugCounter++;
    }

    stats = Stats;
    stats.add('total');
    stats.add('video');
    stats.add('slam');

    $container.appendChild($view);
    document.body.appendChild(stats.el);

    // Add click handler for left frame overlay - toggle video placement
    const leftFrameOverlay = document.getElementById('left-frame-click-overlay');
    if (leftFrameOverlay) {
      leftFrameOverlay.addEventListener('click', (event) => {
        event.stopPropagation();
        
        if (!latestPose) {
          console.log('No valid pose available for video placement');
          return;
        }
        
        // Toggle: if video exists, remove it; otherwise, place it
        if (videoPlayerSystem.videoPosition) {
          console.log('Left frame clicked - removing video');
          videoPlayerSystem.resetVideo();
          if (videoPlayerUI) {
            videoPlayerUI.updateStatus('Video removed - click to place video');
          }
        } else {
          const videoURLInput = document.getElementById('video-url-input');
          const videoURL = videoURLInput ? videoURLInput.value.trim() : 'https://www.youtube.com/watch?v=DszTO3PPyNQ';
          
          console.log('Left frame clicked - placing video at:', videoURL);
          videoPlayerSystem.placeVideo(latestPose, videoURL);
        }
      });
    }

    function render() {
      stats.next();
      stats.start('total');

      let frameLeft = null;
      let frameRight = null;
      let pose = null;

      if (!document.hidden) {
        if (isLiveMode) {
          // Live mode: Convert bitmaps to canvas textures
          if (latestFrameBitmapLeft && latestFrameBitmapRight) {
            // Use UNDISTORTED frames for AR processing (separate from display)
            processingCtxLeft.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
            processingCtxRight.drawImage(latestFrameBitmapRight, 0, 0, image_width, image_height);
            
            // Get ImageData for SLAM processing from undistorted processing canvases
            frameLeft = processingCtxLeft.getImageData(0, 0, image_width, image_height);
            frameRight = processingCtxRight.getImageData(0, 0, image_width, image_height);
          } else {
            requestAnimationFrame(render);
            return;
          }
        } else {
          // Video mode: Get frames from video elements
          if (mediaLeft && mediaRight && mediaLeft.el.readyState >= 2 && mediaRight.el.readyState >= 2) {
            // Use UNDISTORTED frames for AR processing (separate from display)
            processingCtxLeft.drawImage(mediaLeft.el, 0, 0, image_width, image_height);
            processingCtxRight.drawImage(mediaRight.el, 0, 0, image_width, image_height);
            
            // Get ImageData for SLAM processing from undistorted processing canvases
            frameLeft = processingCtxLeft.getImageData(0, 0, image_width, image_height);
            frameRight = processingCtxRight.getImageData(0, 0, image_width, image_height);
          } else {
            requestAnimationFrame(render);
            return;
          }
        }

        if (!frameLeft || !frameRight || !frameLeft.data.length || !frameRight.data.length) {
          requestAnimationFrame(render);
          return;
        }

        if (frameLeft && frameRight) {
          stats.start('video');
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
            
            // Render CSS3D scene for YouTube videos
            if (visualizer && visualizer.css3DRenderer && visualizer.css3DScene) {
              visualizer.renderCSS3D(view.camera);
            }
            
            // Visualize 3D feature points
            visualizeFeaturePoints();
          } else {
            view.lostCamera();
            visualizeFeaturePoints();
          }
          
          // Render ARSimpleView first (if it has a render loop, it should already be rendering)
          // But we need to ensure it renders before we capture
          if (view && view.renderer) {
            view.renderer.render(view.scene, view.camera);
          }
          
          // Composite video + AR overlays on undistorted canvas before distortion
          // 1. Draw video frame (undistorted)
          compositeCtxLeft.clearRect(0, 0, image_width, image_height);
          compositeCtxRight.clearRect(0, 0, image_width, image_height);
          
          if (isLiveMode && latestFrameBitmapLeft) {
            compositeCtxLeft.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
            if (showRightCamera && latestFrameBitmapRight) {
              compositeCtxRight.drawImage(latestFrameBitmapRight, 0, 0, image_width, image_height);
            } else {
              compositeCtxRight.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
            }
          } else if (mediaLeft && mediaLeft.el.readyState >= 2) {
            compositeCtxLeft.drawImage(mediaLeft.el, 0, 0, image_width, image_height);
            if (showRightCamera && mediaRight && mediaRight.el.readyState >= 2) {
              compositeCtxRight.drawImage(mediaRight.el, 0, 0, image_width, image_height);
            } else {
              compositeCtxRight.drawImage(mediaLeft.el, 0, 0, image_width, image_height);
            }
          }
          
          // 2. Capture AR overlay from ARSimpleView renderer and composite it
          if (view && view.renderer && view.renderer.domElement) {
            // Capture AR overlay to canvas
            const arCtxLeft = arOverlayCanvasLeft.getContext('2d');
            arCtxLeft.clearRect(0, 0, image_width, image_height);
            arCtxLeft.drawImage(view.renderer.domElement, 0, 0, image_width, image_height);
            
            // Composite AR overlay on top of video (undistorted)
            compositeCtxLeft.globalCompositeOperation = 'source-over';
            compositeCtxLeft.drawImage(arOverlayCanvasLeft, 0, 0, image_width, image_height);
            
            // For right eye, use same AR overlay (or could render separately if needed)
            const arCtxRight = arOverlayCanvasRight.getContext('2d');
            arCtxRight.clearRect(0, 0, image_width, image_height);
            arCtxRight.drawImage(view.renderer.domElement, 0, 0, image_width, image_height);
            compositeCtxRight.globalCompositeOperation = 'source-over';
            compositeCtxRight.drawImage(arOverlayCanvasRight, 0, 0, image_width, image_height);
          }
          
          // 3. Update textures (composite will be distorted by shader)
          videoTextureLeft.needsUpdate = true;
          videoTextureRight.needsUpdate = true;
        }
      }
      
      // Render AR view with distortion shader (distorts the composite: video + AR overlays)
      const currentWidth = window.innerWidth;
      const currentHeight = window.innerHeight;
      
      renderer.clear();

      // Render Left Eye (Left Half of Canvas)
      renderer.setViewport(0, 0, currentWidth / 2, currentHeight);
      renderer.setScissor(0, 0, currentWidth / 2, currentHeight);
      renderer.setScissorTest(true);
      renderer.render(sceneLeft, cameraLeft);

      // Render Right Eye (Right Half of Canvas)
      if (showRightCamera) {
        renderer.setViewport(currentWidth / 2, 0, currentWidth / 2, currentHeight);
        renderer.setScissor(currentWidth / 2, 0, currentWidth / 2, currentHeight);
        renderer.setScissorTest(true);
        renderer.render(sceneRight, cameraRight);
      } else {
        // Use left camera view for both eyes
        renderer.setViewport(currentWidth / 2, 0, currentWidth / 2, currentHeight);
        renderer.setScissor(currentWidth / 2, 0, currentWidth / 2, currentHeight);
        renderer.setScissorTest(true);
        renderer.render(sceneLeft, cameraLeft);
      }
      
      stats.stop('total');
      stats.render();
      requestAnimationFrame(render);
    }
    render();
  }

  // Set initial panel visibility
  console.log('🔍 [DEBUG] Setting initial panel visibility, panelsVisible:', panelsVisible);
  const panelsContainer = document.getElementById('panels-container');
  const measurementPanel = document.getElementById('measurement-panel');
  const visualizerPanel = document.getElementById('visualizer-panel');
  
  console.log('🔍 [DEBUG] Panel elements found:', {
    panelsContainer: !!panelsContainer,
    measurementPanel: !!measurementPanel,
    visualizerPanel: !!visualizerPanel
  });
  
  if (panelsContainer) {
    console.log('🔍 [DEBUG] Panels container initial state:', {
      display: window.getComputedStyle(panelsContainer).display,
      classList: Array.from(panelsContainer.classList),
      hasPanelsHidden: panelsContainer.classList.contains('panels-hidden')
    });
    
    // Use class-based visibility (CSS handles display with !important)
    if (panelsVisible) {
      panelsContainer.classList.remove('panels-hidden');
      panelsContainer.style.display = ''; // Let CSS handle it
      console.log('✅ [DEBUG] Panels container set to visible, removed panels-hidden class');
    } else {
      panelsContainer.classList.add('panels-hidden');
      console.log('⚠️ [DEBUG] Panels container set to hidden, added panels-hidden class');
    }
    
    console.log('🔍 [DEBUG] Panels container after initial setup:', {
      display: window.getComputedStyle(panelsContainer).display,
      visibility: window.getComputedStyle(panelsContainer).visibility,
      classList: Array.from(panelsContainer.classList),
      marginTop: window.getComputedStyle(panelsContainer).marginTop
    });
  } else {
    console.error('❌ [DEBUG] Panels container not found during initial setup!');
  }
  
  if (measurementPanel) {
    measurementPanel.style.display = panelsVisible ? 'flex' : 'none';
    console.log('🔍 [DEBUG] Measurement panel display set to:', panelsVisible ? 'flex' : 'none');
  } else {
    console.error('❌ [DEBUG] Measurement panel not found!');
  }
  
  if (visualizerPanel) {
    visualizerPanel.style.display = panelsVisible ? 'block' : 'none';
    console.log('🔍 [DEBUG] Visualizer panel display set to:', panelsVisible ? 'block' : 'none');
  } else {
    console.error('❌ [DEBUG] Visualizer panel not found!');
  }

  setTimeout(() => {
    $splash.remove();
    $start.addEventListener('click', () => {
      $overlay.remove();
      
      const container = document.getElementById('container');
      const panelsContainer = document.getElementById('panels-container');
      const measurementPanel = document.getElementById('measurement-panel');
      const visualizerPanel = document.getElementById('visualizer-panel');
      
      if (container) container.style.display = 'block';
      if (panelsContainer) {
        if (panelsVisible) {
          panelsContainer.classList.remove('panels-hidden');
          panelsContainer.style.display = '';
        } else {
          panelsContainer.classList.add('panels-hidden');
        }
      }
      if (measurementPanel) measurementPanel.style.display = panelsVisible ? 'flex' : 'none';
      if (visualizerPanel) visualizerPanel.style.display = panelsVisible ? 'block' : 'none';
      
      demoStream();
    }, { once: true });
  }, splashFadeTime);
}

export { main };

