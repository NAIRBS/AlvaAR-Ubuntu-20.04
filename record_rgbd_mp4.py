import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from cv_bridge import CvBridge
import cv2
import numpy as np
import time


class ConstantFPSVideoSaver(Node):
    def __init__(self):
        super().__init__('constant_fps_video_saver')

        self.bridge = CvBridge()
        self.fps = 30  # constant output FPS
        self.fourcc = cv2.VideoWriter_fourcc(*'mp4v')

        # Will be initialized once we receive the first frames
        self.left_writer = None
        self.right_writer = None
        self.frame_size = None

        self.latest_left = None
        self.latest_right = None

        self.start_time = time.time()

        # Subscriptions
        self.create_subscription(Image, '/camera/camera/infra1/image_rect_raw', self.left_callback, 10)
        self.create_subscription(Image, '/camera/camera/infra2/image_rect_raw', self.right_callback, 10)

        # Timer to write frames at a fixed rate
        self.create_timer(1.0 / self.fps, self.write_frames)

        self.get_logger().info("Recording RGBD stereo video at constant FPS... Press Ctrl+C to stop.")

    def left_callback(self, msg):
        frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
        self.latest_left = frame
        self._init_video_writers(frame)

    def right_callback(self, msg):
        frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
        self.latest_right = frame
        self._init_video_writers(frame)

    def _init_video_writers(self, frame):
        """Initialize VideoWriters based on the first frame size."""
        if self.frame_size is None:
            h, w = frame.shape[:2]
            self.frame_size = (w, h)
            self.get_logger().info(f"Frame size detected: {self.frame_size}")

            self.left_writer = cv2.VideoWriter('mono_left_web.mp4', self.fourcc, self.fps, self.frame_size)
            self.right_writer = cv2.VideoWriter('mono_right_web.mp4', self.fourcc, self.fps, self.frame_size)

    def write_frames(self):
        if self.left_writer is None or self.right_writer is None:
            return  # Wait until we have at least one frame to determine size

        # If we haven't received a new frame, reuse the last one to maintain constant FPS
        if self.latest_left is not None:
            self.left_writer.write(self.latest_left)
        else:
            self.left_writer.write(np.zeros((self.frame_size[1], self.frame_size[0], 3), dtype=np.uint8))

        if self.latest_right is not None:
            self.right_writer.write(self.latest_right)
        else:
            self.right_writer.write(np.zeros((self.frame_size[1], self.frame_size[0], 3), dtype=np.uint8))

    def destroy_node(self):
        duration = time.time() - self.start_time
        self.get_logger().info(f"Recording stopped. Duration: {duration:.2f} seconds")

        if self.left_writer:
            self.left_writer.release()
        if self.right_writer:
            self.right_writer.release()

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
