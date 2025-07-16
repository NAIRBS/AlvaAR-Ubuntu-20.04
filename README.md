# AlvaAR (Now for Ubuntu 20.04)

AlvaAR is a real-time visual SLAM algorithm running as WebAssembly, in the browser. It is a heavily modified version of the [OV²SLAM](https://github.com/ov2slam/ov2slam) and [ORB-SLAM2](https://github.com/raulmur/ORB_SLAM2) projects. 

SLAM is the core building block of Augmented Reality applications, focusing on world tracking.

![image](examples/public/assets/image.gif)

## Examples
The examples use [ThreeJS](https://threejs.org/) to apply and render the estimated camera pose to a 3d environment.  

[Video Demo](https://alanross.github.io/AlvaAR/examples/public/video.html): A desktop browser version using a video file as input.  
[Camera Demo](https://alanross.github.io/AlvaAR/examples/public/camera.html): The mobile version will access the device camera as input.

<img width="75" src="examples/public/assets/qr.png">

# This repository is under ongoing development. Planned enhancements are:
1. ORBSLAM2 to ORBSLAM3, specifically to support Fisheye lens (ORBSLAM3 exclusive)
2. Monocular Camera to Stereo Camera use
3. Pipe input from 2 ESP32 Webserver Cam Modules to build a prototype AR Headset (currently only accepts video.mp4 and single mobile phone camera input)

## File Change Notes
- The `build.sh` script in `/src/libs` has been adapted for Linux compatibility; the original codebase was developed for macOS.

- The file [`buildtests.in`](https://github.com/PX4/eigen/blob/master/scripts/buildtests.in) from the Eigen libs dependency folder was missing is now added to this folder [`/src/libs/eigen/scripts`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/tree/main/src/libs/eigen/scripts).

- The following CMakeLists files have been modified to avoid errors related to the `-march=native` flag (WebAssembly is based on a virtual machine and does not support this flag):
  - [`src/libs/obindex2/lib/CMakeLists.txt`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/blob/main/src/libs/obindex2/lib/CMakeLists.txt)
  - [`src/libs/ibow_lcd/CMakeLists.txt`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/blob/main/src/libs/ibow_lcd/CMakeLists.txt)
  - [`src/libs/opengv/CMakeLists.txt`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/blob/main/src/libs/opengv/CMakeLists.txt)

- Updated port used in HTTPS to 8080, not 443 since it's private, in [`/examples/server.js`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/blob/main/examples/server.js)

## Ubuntu Specific Setup
```
    cd ~
    git clone https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04

    sudo apt update
    sudo apt install build-essential cmake python3 python3-pip nodejs npm python-is-python3

    # In home directory
    git clone https://github.com/emscripten-core/emsdk.git
    cd emsdk

    # Fetch the latest version of the emsdk (not needed the first time you clone)
    git pull

    # Download and install the latest SDK tools.
    ./emsdk install 3.1.44

    # Make the "latest" SDK "active" for the current user. (writes .emscripten file)
    ./emsdk activate 3.1.44

    # Activate PATH and other environment variables in the current terminal
    source ~/emsdk/emsdk_env.sh

    # Check if emcc is active in current terminal
    emcc -v

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    source ~/.bashrc
    nvm --version

    nvm install 18
    nvm use 18
```

## After running the above, you need to build 3 things
1. Dependencies
2. AlvaAR / SLAM Libraries
3. HTTPS Server (if required)

## 1. Dependencies
### Prerequisites

#### Emscripten
Ensure [Emscripten](https://emscripten.org/docs/getting_started/Tutorial.html) is installed and activated in your session. This is already shown above, but please check again if your path differs:

```
    $: source [PATH]/emsdk/emsdk_env.sh 
    $: emcc -v
```
#### C++11 or Higher
Alva makes use of C++11 features and should thus be compiled with a C++11 or higher flag.

### Dependencies

| Dependency             | Description                                                                                                                                                                                                                                                                                                                                                                                                                         |
|------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Eigen3                 | Download Eigen 3.4. Find all releases [here](https://eigen.tuxfamily.org/index.php?title=Main_Page). This project has been tested with 3.4.0                                                                                                                                                                                                                                                                                         |
| OpenCV                 | Download OpenCV 4.5. Find all releases [here](https://opencv.org/releases/). This project has been tested with [4.5.5](https://github.com/opencv/opencv/archive/4.5.5.zip).                                                                                                                                                                                                                                                          |
| iBoW-LCD               | A modified version of [iBoW-LCD](https://github.com/emiliofidalgo/ibow-lcd) is included in the libs folder. It has been turned into a static shared lib. Same goes for [OBIndex2](https://github.com/emiliofidalgo/obindex2), the required dependency for iBoW-LCD. Check the lcdetector.h and lcdetector.cc files to see the modifications w.r.t. to the original code. Both CMakeList have been adjusted to work with Emscripten. |
| Sophus                 | [Sophus](https://github.com/strasdat/Sophus) is used for _*SE(3), SO(3)*_ elements representation.                                                                                                                                                                                                                                                                                                                                  |
| Ceres Solver           | [Ceres](https://github.com/ceres-solver/ceres-solver) is used for optimization related operations such as PnP, Bundle Adjustment or PoseGraph Optimization. Note that [Ceres dependencies](http://ceres-solver.org/installation.html) are still required.                                                                                                                                                                           |
| OpenGV                 | [OpenGV](https://github.com/laurentkneip/opengv) is used for Multi-View-Geometry (MVG) operations.                                                                                                                                                                                                                                                                                                                                  |
#### Build Dependencies
For convenience, a copy of all required libraries has been included in the libs/ folder. Run the following script to compile all libraries to WASM modules, which can be linked into the main project.

**Note that this script has been changed such that march-native flags do not cause late-stage conflicts later.**

```
    $: cd ~/AlvaAR-Ubuntu-20.04/src/libs/
    $: ./build.sh
```

## 2. AlvaAR / SLAM Libraries
Then, run the following:

```
    $: cd ~/AlvaAR-Ubuntu-20.04/src/slam
    $: mkdir build/
    $: cd build/
    $: emcmake cmake .. 
    $: emmake make install
```

## 3. HTTPS Server (if required)



### Run with http server
To run the examples on your local machine, start a simple http server in the examples/ folder:

`$: python 2: python -m SimpleHTTPServer 8080` or   
`$: python 3: python -m http.server 8080` or  
`$: emrun --browser chrome ./`

Then open [http://localhost:8080/public/video.html](http://localhost:8080/public/video.html]) in your browser.

### Run with https server
To run the examples on another device in your local network, they must be served via https. For convenience, a simple https server was added to this project – do not use for production.

#### 1) Install server dependencies
```
    $: cd ~/AlvaAR-Ubuntu-20.04/examples/
    $: npm install
```
#### 2) Generate a self-signed certificate
```
    $: cd ~/AlvaAR-Ubuntu-20.04/examples
    $: mkdir ssl/
    $: cd ssl/
    $: openssl req -nodes -new -x509 -keyout key.pem -out cert.pem
```
#### 3) Run
```
    $: cd ~/AlvaAR-Ubuntu-20.04/examples/
    $: nvm use 18
    $: npm start
``` 

Where you should then see something similar to:

```
> simple-https-server@1.0.0 start
> node server.js

Server running at: https://10.255.255.254:8080
```

**To run with recorded video: Open [https://YOUR_IP:8080/video.html](https://YOUR_IP:8080/video.html) in your browser.**

**To run with Mobile Camera/Webcam: Open [https://YOUR_IP:8080/camera.html](https://YOUR_IP:8080/video.html) in your (mobile) browser.**

Note that if you are running on WSL, the IP provided in the terminal will not work, run:
```
    $: hostname -I
```
And use that IP address instead, etc: [https://WSL_IP:8080/camera.html](https://WSL_IP:8080/camera.html)

If met with a <b>ERR_CERT_INVALID</b> error in Chrome, try typing <i>badidea</i> or <i>thisisunsafe</i> directly in Chrome on the same page.
Don’t do this unless the site is one you trust or have developed.

## Usage with ESP32 Camera Modules
Use this ROS2 node to publish rectified Stereo ESP32 Camera Input: [stereo_camera_pipeline](https://github.com/Shye0930/stereo_camera_pipeline)
1. Instructions on optimal ESP32 Camera flashing and calibration here: [ros2_rolling](https://github.com/Shye0930/fyp/tree/main/camera/camera_calibration/ros2_rolling) << This is currently privated
2. Once you've flashed your ESP32s (pinhole cameras) and obtained calibration matrixes/data from step 1, you need to connect your ESP32s (with hardcoded SSID login) to the local wifi/hotspot, you also need to connect your machine to the same wifi/hotspot. You also need to format the calibration data into the yaml config file format.
3. Make sure to update the ip addresses assigned by your wifi/hotspot and the calibration file location in stereo_pipeline.launch.py, then run the following to start publishing video frames in ROS2 topics:
```
    $: ros2 launch stereo_camera_pipeline stereo_pipeline.launch.py
```
After you've started publishing the stereo rectified (and raw frames) from running the previous pipeline node, you should see the available topics named:
```
$: ros2 topic list
/parameter_events
/rosout
/stereo/left/camera_info
/stereo/left/image_raw
/stereo/left/rectified_images
/stereo/right/camera_info
/stereo/right/image_raw
/stereo/right/rectified_images
```
4. Run this script to publish the data in the ROS2 topics, this is so that AlvaAR is able to grab the frames on the receiving end from the ESP32 Camera input:
```
    $: python3 ros2_ws_server_blob.py
```
5. Then run:
```
    $: cd ~/AlvaAR-Ubuntu-20.04/examples/
    $: npm start
```
**To run with ESP32 Stereo Input: Open [https://YOUR_IP:8080/both_esp32blob.html](https://YOUR_IP:8080/both_esp32blob.html) in your browser.**

Note that if you are running on WSL, the IP provided in the terminal will not work, run:
```
    $: hostname -I
```
And use that IP address instead, etc: [https://WSL_IP:8080/both_esp32blob.html](https://WSL_IP:8080/both_esp32blob.html)

### Note that you must open the URL on the same machine that is hosting the HTTPS server, as the ESP32 Camera video feeds are routed through localhost.

## Usage

This code shows how to send image data to AlvaAR to compute the camera pose.

```javascript
import { AlvaAR } from 'alva_ar.js';

const videoOrWebcam = /*...*/;

const width = videoOrWebcam.width;
const height = videoOrWebcam.height;

const canvas = document.getElementById( 'canvas' );
const ctx = canvas.getContext( '2d' );

canvas.width = width;
canvas.height = height;

const alva = await AlvaAR.Initialize( width, height );

function loop()
{
    ctx.clearRect( 0, 0, width, height );
    ctx.drawImage( videoOrWebcam, 0, 0, width, height );
    
    const frame = ctx.getImageData( 0, 0, width, height );
    
    // cameraPose holds the rotation/translation information where the camera is estimated to be
    const cameraPose = alva.findCameraPose( frame );
    
    // planePose holds the rotation/translation information of a detected plane
    const planePose = alva.findPlane();
    
    // The tracked points in the frame
    const points = alva.getFramePoints();

    for( const p of points )
    {
        ctx.fillRect( p.x, p.y, 2, 2 );
    }
};
```


## Roadmap
- [ ] Improve the initialisation phase to be more stable and predictable.
- [ ] Move feature extraction and tracking to GPU.
- [ ] Blend visual SLAM with IMU data to increase robustness. 


## License

AlvaAR is released under the [GPLv3 license](https://www.gnu.org/licenses/gpl-3.0.txt).  

OV²SLAM and ORB-SLAM2 are both released under the [GPLv3 license](https://www.gnu.org/licenses/gpl-3.0.txt). Please see 3rd party dependency licenses in libs/.


## Contact for Main Author

Alan Ross: [@alan_ross](https://twitter.com/alan_ross) or [me@aross.io]()  
Main Project Link: [https://github.com/alanross/AlvaAR](https://github.com/alanross/AlvaAR)