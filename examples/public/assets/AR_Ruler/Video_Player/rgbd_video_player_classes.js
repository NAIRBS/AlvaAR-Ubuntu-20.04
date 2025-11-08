// Video Player Visualizer
import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/build/three.module.js';
import { CSS3DRenderer, CSS3DObject } from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/examples/jsm/renderers/CSS3DRenderer.js';
import { extractYouTubeVideoId, isYouTubeURL, createYouTubeEmbedURL } from './rgbd_video_player_script.js';

export class VideoPlayerVisualizer {
  constructor(scene, sceneVisualizer = null) {
    this.scene = scene;
    this.sceneVisualizer = sceneVisualizer;
    this.videoElement = null;
    this.videoMesh = null;
    this.videoTexture = null;
    this.videoPosition = null;
    this.css3DScene = null;
    this.css3DRenderer = null;
    this.youtubeIframe = null;
    this.css3DObject = null;
  }

  // Create video in 3D space
  createVideo(position, videoURL) {
    // Remove existing video
    this.removeVideo();
    
    this.videoPosition = position.clone();
    
    if (isYouTubeURL(videoURL)) {
      // Handle YouTube video
      this.createYouTubeVideo(position, videoURL);
    } else {
      // Handle regular video file
      this.createVideoFile(position, videoURL);
    }
    
    // Also create in 3D scene visualizer
    if (this.sceneVisualizer) {
      this.createVideoInSceneVisualizer(position, videoURL);
    }
    
    console.log('Video created at:', position);
  }

  // Create YouTube video using CSS3D renderer for iframe embedding
  createYouTubeVideo(position, videoURL) {
    console.log('🎬 [DEBUG] createYouTubeVideo called with:', { position, videoURL });
    
    const videoId = extractYouTubeVideoId(videoURL);
    if (!videoId) {
      console.error('❌ [DEBUG] Invalid YouTube URL - cannot extract video ID:', videoURL);
      console.error('❌ [DEBUG] Make sure URL is in format: https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID');
      return;
    }
    console.log('✅ [DEBUG] Extracted video ID:', videoId);

    const embedURL = createYouTubeEmbedURL(videoId);
    if (!embedURL) {
      console.error('❌ [DEBUG] Failed to create embed URL');
      return;
    }
    
    // CRITICAL: Verify we're using /embed/ endpoint, not /watch/
    if (!embedURL.includes('/embed/')) {
      console.error('❌ [DEBUG] FATAL ERROR: Embed URL does not use /embed/ endpoint!');
      console.error('❌ [DEBUG] URL:', embedURL);
      return;
    }
    
    if (embedURL.includes('/watch')) {
      console.error('❌ [DEBUG] FATAL ERROR: Embed URL incorrectly uses /watch/ endpoint!');
      console.error('❌ [DEBUG] URL:', embedURL);
      return;
    }
    
    console.log('🔗 [DEBUG] YouTube embed URL (verified):', embedURL);
    console.log('📋 [DEBUG] URL parameters check:', {
      hasAutoplay: embedURL.includes('autoplay=1'),
      hasMute: embedURL.includes('mute=1'),
      hasControls: embedURL.includes('controls=1')
    });
    
    // CRITICAL: Create iframe element WITHOUT src first
    // YouTube iframes can refuse to connect if src is set before they're in the DOM
    const iframe = document.createElement('iframe');
    iframe.width = '640';
    iframe.height = '360';
    iframe.frameBorder = '0';
    iframe.setAttribute('frameborder', '0'); // Also set as attribute
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    iframe.allowFullscreen = true;
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.style.visibility = 'visible';
    
    // IMPORTANT: Do NOT set src yet - wait until iframe is in DOM
    console.log('⏳ [DEBUG] Iframe created without src, will set after DOM attachment');
    
    // Add comprehensive event listeners for debugging
    iframe.addEventListener('load', () => {
      console.log('✅ [DEBUG] Iframe loaded successfully');
      console.log('📊 [DEBUG] Iframe details:', {
        src: iframe.src,
        width: iframe.width,
        height: iframe.height,
        allow: iframe.allow,
        inDocument: document.body.contains(iframe) || document.contains(iframe)
      });
      
      // Check if iframe is actually in the DOM
      const iframeInDOM = document.querySelector(`iframe[src*="${videoId}"]`);
      console.log('🔍 [DEBUG] Iframe found in DOM:', !!iframeInDOM);
      
      // Try to detect autoplay status
      setTimeout(() => {
        console.log('⏱️ [DEBUG] Checking autoplay status after 1 second...');
        
        // Check iframe visibility and position
        const iframeRect = iframe.getBoundingClientRect();
        const iframeComputed = window.getComputedStyle(iframe);
        console.log('👁️ [DEBUG] Iframe visibility check:', {
          boundingRect: {
            x: iframeRect.x,
            y: iframeRect.y,
            width: iframeRect.width,
            height: iframeRect.height,
            visible: iframeRect.width > 0 && iframeRect.height > 0
          },
          computedStyle: {
            display: iframeComputed.display,
            visibility: iframeComputed.visibility,
            opacity: iframeComputed.opacity,
            transform: iframeComputed.transform,
            position: iframeComputed.position
          },
          inViewport: iframeRect.x >= 0 && iframeRect.y >= 0 && 
                     iframeRect.x < window.innerWidth && 
                     iframeRect.y < window.innerHeight
        });
        
        // Check if iframe has content loaded
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          console.log('📄 [DEBUG] Iframe document access:', {
            canAccess: !!iframeDoc,
            hasBody: !!iframeDoc?.body,
            url: iframeDoc?.URL || 'cannot access'
          });
        } catch (e) {
          console.log('🔒 [DEBUG] Cannot access iframe document (cross-origin):', e.message);
        }
        
        // Note: We can't directly check YouTube's internal state, but we can log
        console.log('💡 [DEBUG] If video is not playing, possible reasons:');
        console.log('   1. Browser autoplay policy blocking (even with mute=1)');
        console.log('   2. YouTube API not responding');
        console.log('   3. Iframe not properly attached to CSS3D scene');
        console.log('   4. CSS3DRenderer not rendering the iframe');
        console.log('   5. Iframe positioned outside viewport');
        console.log('   6. CSS3D transform making iframe invisible to browser');
      }, 1000);
      
      // Check again after 3 seconds
      setTimeout(() => {
        console.log('⏱️ [DEBUG] Checking autoplay status after 3 seconds...');
        const iframeRect = iframe.getBoundingClientRect();
        console.log('📊 [DEBUG] Iframe still in viewport:', {
          visible: iframeRect.width > 0 && iframeRect.height > 0,
          position: { x: iframeRect.x, y: iframeRect.y },
          size: { width: iframeRect.width, height: iframeRect.height }
        });
      }, 3000);
    });
    
    iframe.addEventListener('error', (e) => {
      console.error('❌ [DEBUG] Iframe error:', e);
    });
    
    // Listen for postMessage from YouTube (if API is enabled)
    // Store reference to remove listener later if needed
    this.youtubeMessageHandler = (event) => {
      if (event.origin === 'https://www.youtube.com') {
        console.log('📨 [DEBUG] Message from YouTube:', event.data);
        if (event.data && typeof event.data === 'object') {
          if (event.data.event === 'onStateChange') {
            console.log('🎥 [DEBUG] YouTube player state changed:', {
              state: event.data.info,
              stateName: ['unstarted', 'ended', 'playing', 'paused', 'buffering', 'cued'][event.data.info] || 'unknown'
            });
          } else if (event.data.event === 'onReady') {
            console.log('✅ [DEBUG] YouTube player ready!');
          } else if (event.data.event === 'onError') {
            console.error('❌ [DEBUG] YouTube player error:', event.data.info);
          }
        }
      }
    };
    window.addEventListener('message', this.youtubeMessageHandler);
    
    // Log if no messages received after 2 seconds
    setTimeout(() => {
      console.log('⚠️ [DEBUG] No YouTube messages received after 2 seconds');
      console.log('💡 [DEBUG] This might indicate:');
      console.log('   - YouTube player not initializing');
      console.log('   - enablejsapi=1 not working');
      console.log('   - Browser blocking cross-origin messages');
    }, 2000);
    
    this.youtubeIframe = iframe;
    console.log('📦 [DEBUG] Iframe element created:', {
      tagName: iframe.tagName,
      src: iframe.src,
      hasParent: !!iframe.parentElement
    });
    
    // Use CSS3DRenderer to position iframe in 3D space
    if (!this.css3DRenderer) {
      console.log('🎨 [DEBUG] Creating new CSS3DRenderer...');
      this.css3DRenderer = new CSS3DRenderer();
      const container = document.getElementById('container');
      if (container) {
        const width = container.offsetWidth || 640;
        const height = container.offsetHeight || 480;
        console.log('📐 [DEBUG] Container size:', { width, height });
        this.css3DRenderer.setSize(width, height);
        this.css3DRenderer.domElement.style.position = 'absolute';
        this.css3DRenderer.domElement.style.top = '0';
        this.css3DRenderer.domElement.style.left = '0';
        this.css3DRenderer.domElement.style.pointerEvents = 'auto'; // Enable pointer events for iframe
        this.css3DRenderer.domElement.style.zIndex = '1000'; // Ensure it's on top
        container.appendChild(this.css3DRenderer.domElement);
        console.log('✅ [DEBUG] CSS3DRenderer initialized and added to container');
        console.log('📊 [DEBUG] CSS3DRenderer DOM element:', {
          tagName: this.css3DRenderer.domElement.tagName,
          style: {
            position: this.css3DRenderer.domElement.style.position,
            zIndex: this.css3DRenderer.domElement.style.zIndex,
            pointerEvents: this.css3DRenderer.domElement.style.pointerEvents
          }
        });
      } else {
        console.error('❌ [DEBUG] Container not found!');
      }
    } else {
      console.log('♻️ [DEBUG] Using existing CSS3DRenderer');
    }
    
    if (!this.css3DScene) {
      console.log('🌐 [DEBUG] Creating new CSS3D scene');
      this.css3DScene = new THREE.Scene();
    } else {
      console.log('♻️ [DEBUG] Using existing CSS3D scene');
    }
    
    // Create CSS3D object
    console.log('🎯 [DEBUG] Creating CSS3DObject from iframe...');
    const css3DObject = new CSS3DObject(iframe);
    console.log('✅ [DEBUG] CSS3DObject created:', {
      element: css3DObject.element,
      hasElement: !!css3DObject.element,
      elementTagName: css3DObject.element?.tagName
    });
    
    // Scale and position - make video visible size (1 unit = 1 meter in this coordinate system)
    // Scale to make video about 0.8m wide (16:9 aspect ratio)
    const videoWidth = 0.8; // 80cm width
    const videoHeight = videoWidth * (360 / 640); // Maintain 16:9 aspect
    const scaleX = videoWidth / 640; // Convert pixels to meters
    const scaleY = videoHeight / 360;
    
    css3DObject.scale.set(scaleX, scaleY, 1);
    css3DObject.position.copy(position);
    
    // Make video face the camera (camera looks along -Z, so video should face +Z)
    // No rotation needed if CSS3DObject faces +Z by default
    css3DObject.rotation.set(0, 0, 0);
    
    // Make iframe visible
    iframe.style.display = 'block';
    iframe.style.visibility = 'visible';
    
    console.log('📏 [DEBUG] CSS3DObject transform:', {
      position: { x: position.x, y: position.y, z: position.z },
      scale: { x: scaleX, y: scaleY, z: 1 },
      rotation: { x: css3DObject.rotation.x, y: css3DObject.rotation.y, z: css3DObject.rotation.z }
    });
    
    // NOTE: css3DObject and scene.add will be done in setTimeout below
    // to ensure iframe is in DOM before setting src
    
    // CRITICAL FIX: Temporarily append iframe to body to ensure it's in DOM
    // YouTube iframes refuse to connect if src is set before they're properly in the DOM
    // CSS3DRenderer might clone/move elements, so we ensure it's in DOM first
    iframe.style.position = 'absolute';
    iframe.style.left = '-9999px'; // Hide it off-screen
    iframe.style.top = '-9999px';
    document.body.appendChild(iframe);
    console.log('📌 [DEBUG] Iframe temporarily appended to body (hidden)');
    
    // Set src now that iframe is guaranteed to be in DOM
    iframe.src = embedURL;
    console.log('🔗 [DEBUG] Iframe src set to:', embedURL);
    console.log('✅ [DEBUG] Iframe is in DOM with src set');
    
    // Wait a moment for YouTube to start connecting, then move to CSS3D
    setTimeout(() => {
      // Remove from body
      if ( (iframe.parentElement === document.body) ) {
        document.body.removeChild(iframe);
        console.log('🔄 [DEBUG] Iframe removed from body, moving to CSS3D');
      }
      
      // Reset positioning styles (CSS3D will handle positioning)
      iframe.style.position = '';
      iframe.style.left = '';
      iframe.style.top = '';
      
      // Now add to CSS3D scene
      this.css3DObject = css3DObject;
      this.css3DScene.add(css3DObject);
      console.log('✅ [DEBUG] CSS3DObject added to scene after iframe connection');
      
      // Force initial render
      if (this.css3DRenderer && this.css3DScene) {
        const container = document.getElementById('container');
        if (container) {
          const tempCamera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
          tempCamera.position.set(0, 0, 0);
          tempCamera.lookAt(0, 0, 1);
          this.css3DRenderer.render(this.css3DScene, tempCamera);
          console.log('🎨 [DEBUG] CSS3DRenderer rendered with iframe');
        }
      }
    }, 100); // Small delay to let YouTube start connecting
    
    // Check if iframe is actually in the DOM after being added to CSS3D scene
    setTimeout(() => {
      const iframeInDOM = document.querySelector(`iframe[src*="${videoId}"]`);
      console.log('🔍 [DEBUG] Iframe in DOM after CSS3D setup:', !!iframeInDOM);
      if (iframeInDOM) {
        const computed = window.getComputedStyle(iframeInDOM);
        const rect = iframeInDOM.getBoundingClientRect();
        console.log('📍 [DEBUG] Iframe location in DOM:', {
          parent: iframeInDOM.parentElement?.tagName,
          parentClasses: iframeInDOM.parentElement?.className,
          computedStyle: {
            display: computed.display,
            visibility: computed.visibility,
            opacity: computed.opacity,
            transform: computed.transform,
            position: computed.position,
            zIndex: computed.zIndex
          },
          boundingRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left
          },
          isVisible: rect.width > 0 && rect.height > 0 && computed.visibility !== 'hidden' && computed.opacity !== '0'
        });
        
        // Check parent chain
        let parent = iframeInDOM.parentElement;
        let depth = 0;
        console.log('🌳 [DEBUG] Iframe parent chain:');
        while (parent && depth < 5) {
          const parentComputed = window.getComputedStyle(parent);
          console.log(`   Level ${depth}:`, {
            tagName: parent.tagName,
            className: parent.className,
            id: parent.id,
            display: parentComputed.display,
            visibility: parentComputed.visibility,
            opacity: parentComputed.opacity,
            transform: parentComputed.transform
          });
          parent = parent.parentElement;
          depth++;
        }
      }
    }, 100);
    
    console.log('✅ [DEBUG] YouTube video iframe created at:', position);
  }

  // Create regular video file
  createVideoFile(position, videoURL) {
    console.log('🎬 [DEBUG] createVideoFile called with:', { position, videoURL });
    
    // Create video element
    const video = document.createElement('video');
    video.src = videoURL;
    // Only set crossOrigin for external URLs, not local files
    if (videoURL.startsWith('http://') || videoURL.startsWith('https://')) {
      video.crossOrigin = 'anonymous';
    }
    video.loop = true;
    video.muted = false; // Enable sound
    video.playsInline = true;
    video.autoplay = true; // Enable autoplay
    
    // Add event listeners for debugging
    video.addEventListener('loadstart', () => {
      console.log('📹 [DEBUG] Video load started');
    });
    
    video.addEventListener('loadedmetadata', () => {
      console.log('✅ [DEBUG] Video metadata loaded:', {
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight
      });
      video.play().catch(err => {
        console.error('❌ [DEBUG] Error playing video (autoplay blocked?):', err);
        console.log('💡 [DEBUG] User interaction may be required to play video with sound');
      });
    });
    
    video.addEventListener('canplay', () => {
      console.log('▶️ [DEBUG] Video can play');
      video.play().catch(err => {
        console.error('❌ [DEBUG] Error playing video:', err);
      });
    });
    
    video.addEventListener('play', () => {
      console.log('✅ [DEBUG] Video is playing');
    });
    
    video.addEventListener('error', (e) => {
      console.error('❌ [DEBUG] Video error:', e);
      console.error('❌ [DEBUG] Video error details:', {
        code: video.error?.code,
        message: video.error?.message
      });
    });
    
    this.videoElement = video;
    
    // Create video texture
    const texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.videoTexture = texture;
    
    // Use actual video aspect ratio if available, otherwise default to 16:9
    let aspectRatio = 16 / 9;
    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) {
        aspectRatio = video.videoWidth / video.videoHeight;
        // Update geometry if needed
        const width = 0.8;
        const height = width / aspectRatio;
        if (this.videoMesh) {
          this.videoMesh.geometry.dispose();
          this.videoMesh.geometry = new THREE.PlaneGeometry(width, height);
        }
      }
    });
    
    // Create plane geometry for video
    const width = 0.8; // 80cm width
    const height = width / aspectRatio;
    const geometry = new THREE.PlaneGeometry(width, height);
    
    // Create material with video texture
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });
    
    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    
    // Rotate to face camera (camera is at origin looking along -Z)
    // Video should face +Z direction
    mesh.lookAt(new THREE.Vector3(0, 0, 0));
    const lookAtVector = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), position).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), lookAtVector);
    
    this.videoMesh = mesh;
    this.scene.add(mesh);
    
    // Try to start playing immediately
    video.play().catch(err => {
      console.error('❌ [DEBUG] Initial play() failed (may need user interaction):', err);
    });
    
    console.log('✅ [DEBUG] Video file created at:', position);
  }

  // Create video in 3D scene visualizer (for debugging)
  createVideoInSceneVisualizer(position, videoURL) {
    // Create a simple placeholder in the 3D scene visualizer
    const geometry = new THREE.BoxGeometry(0.2, 0.1, 0.01);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.copy(position);
    marker.userData = { isVideo: true, videoURL };
    this.sceneVisualizer.scene.add(marker);
  }

  // Update video position
  updateVideoPosition(position) {
    this.videoPosition = position.clone();
    
    if (this.videoMesh) {
      this.videoMesh.position.copy(position);
    }
    
    if (this.css3DObject) {
      this.css3DObject.position.copy(position);
    }
  }

  // Render CSS3D scene (call this in render loop)
  renderCSS3D(camera) {
    if (this.css3DRenderer && this.css3DScene && camera) {
      // Update CSS3D object transforms based on camera
      if (this.css3DObject) {
        // Update renderer size if container size changed
        const container = document.getElementById('container');
        if (container) {
          const width = container.offsetWidth || 640;
          const height = container.offsetHeight || 480;
          this.css3DRenderer.setSize(width, height);
        }
        
        // CSS3DRenderer handles the transform automatically
        this.css3DRenderer.render(this.css3DScene, camera);
        
        // Debug logging (throttled to avoid spam)
        if (!this._lastDebugLog || Date.now() - this._lastDebugLog > 5000) {
          this._lastDebugLog = Date.now();
          console.log('🔄 [DEBUG] CSS3D render:', {
            hasRenderer: !!this.css3DRenderer,
            hasScene: !!this.css3DScene,
            hasObject: !!this.css3DObject,
            sceneChildren: this.css3DScene.children.length,
            cameraPosition: camera.position ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : 'no position'
          });
        }
      }
    } else {
      if (!this._lastDebugLog || Date.now() - this._lastDebugLog > 5000) {
        this._lastDebugLog = Date.now();
        console.log('⚠️ [DEBUG] CSS3D render skipped:', {
          hasRenderer: !!this.css3DRenderer,
          hasScene: !!this.css3DScene,
          hasCamera: !!camera,
          hasObject: !!this.css3DObject
        });
      }
    }
  }

  // Remove video
  removeVideo() {
    if (this.videoMesh) {
      this.scene.remove(this.videoMesh);
      if (this.videoMesh.geometry) this.videoMesh.geometry.dispose();
      if (this.videoMesh.material) {
        if (this.videoMesh.material.map) this.videoMesh.material.map.dispose();
        this.videoMesh.material.dispose();
      }
      this.videoMesh = null;
    }
    
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement = null;
    }
    
    if (this.videoTexture) {
      this.videoTexture.dispose();
      this.videoTexture = null;
    }
    
    if (this.css3DObject && this.css3DScene) {
      this.css3DScene.remove(this.css3DObject);
      this.css3DObject = null;
    }
    
    if (this.youtubeIframe) {
      this.youtubeIframe.remove();
      this.youtubeIframe = null;
    }
    
    this.videoPosition = null;
  }
}

// Video Player UI
export class VideoPlayerUI {
  constructor() {
    this.statusDisplay = document.getElementById('status-display');
    this.videoDistanceSlider = document.getElementById('video-distance-slider');
    this.videoDistanceValue = document.getElementById('video-distance-value');
    this.placeVideoBtn = document.getElementById('place-video');
    this.resetVideoBtn = document.getElementById('reset-video');
    
    // Set up slider
    if (this.videoDistanceSlider && this.videoDistanceValue) {
      this.videoDistanceSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        this.videoDistanceValue.textContent = value.toFixed(2) + ' meters';
      });
    }
  }

  updateStatus(message) {
    if (this.statusDisplay) {
      this.statusDisplay.textContent = message;
    }
  }

  getVideoDistance() {
    if (this.videoDistanceSlider) {
      return parseFloat(this.videoDistanceSlider.value);
    }
    return 0.0;
  }

  reset() {
    if (this.statusDisplay) {
      this.statusDisplay.textContent = 'Click left frame to place video';
    }
    if (this.videoDistanceSlider) {
      this.videoDistanceSlider.value = '0.0';
    }
    if (this.videoDistanceValue) {
      this.videoDistanceValue.textContent = '0.00 meters';
    }
  }
}

