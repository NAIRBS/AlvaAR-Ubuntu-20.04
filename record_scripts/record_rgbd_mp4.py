import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from cv_bridge import CvBridge
import cv2
import numpy as np
import time
import subprocess


class ConstantFPSVideoSaver(Node):
    def __init__(self):
        super().__init__('constant_fps_video_saver')

        self.bridge = CvBridge()
        self.fps = 30  # constant output FPS

        # Writers (ffmpeg processes)
        self.left_proc = None
        self.right_proc = None
        self.frame_size = None

        self.latest_left = None
        self.latest_right = None

        self.start_time = time.time()

        # Subscriptions
        self.create_subscription(Image, '/camera/camera/infra1/image_rect_raw', self.left_callback, 10)
        self.create_subscription(Image, '/camera/camera/infra2/image_rect_raw', self.right_callback, 10)

        # Timer to write frames at a fixed rate
        self.create_timer(1.0 / self.fps, self.write_frames)

        self.get_logger().info("Recording stereo video at constant FPS (H.264, faststart)... Press Ctrl+C to stop.")

    def left_callback(self, msg):
        frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
        self.latest_left = frame
        self._init_video_writers(frame)

    def right_callback(self, msg):
        frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
        self.latest_right = frame
        self._init_video_writers(frame)

    def _init_video_writers(self, frame):
        """Initialize ffmpeg processes based on the first frame size."""
        if self.frame_size is None:
            h, w = frame.shape[:2]
            self.frame_size = (w, h)
            self.get_logger().info(f"Frame size detected: {self.frame_size}")

            ffmpeg_cmd_left = [
                'ffmpeg',
                '-y',
                '-f', 'rawvideo',
                '-pix_fmt', 'bgr24',
                '-s', f"{w}x{h}",
                '-r', str(self.fps),
                '-i', '-', 
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p', # Needed for firefox codec compatibility
                '-preset', 'fast',
                '-crf', '23',
                '-movflags', '+faststart',
                'mono_left_web.mp4'
            ]
            ffmpeg_cmd_right = ffmpeg_cmd_left.copy()
            ffmpeg_cmd_right[-1] = 'mono_right_web.mp4'

            self.left_proc = subprocess.Popen(ffmpeg_cmd_left, stdin=subprocess.PIPE)
            self.right_proc = subprocess.Popen(ffmpeg_cmd_right, stdin=subprocess.PIPE)

    def write_frames(self):
        if self.left_proc is None or self.right_proc is None:
            return  # Not ready yet

        # Always write the latest frame (reused if no new one arrived)
        if self.latest_left is not None:
            self.left_proc.stdin.write(self.latest_left.tobytes())

        if self.latest_right is not None:
            self.right_proc.stdin.write(self.latest_right.tobytes())

    def destroy_node(self):
        duration = time.time() - self.start_time
        self.get_logger().info(f"Recording stopped. Duration: {duration:.2f} seconds")

        # Properly close ffmpeg processes
        if self.left_proc:
            self.left_proc.stdin.close()
            self.left_proc.wait()
        if self.right_proc:
            self.right_proc.stdin.close()
            self.right_proc.wait()

        super().destroy_node()


def main():
    rclpy.init()
    node = ConstantFPSVideoSaver()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
