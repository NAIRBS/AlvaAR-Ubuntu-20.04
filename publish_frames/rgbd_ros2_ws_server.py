import asyncio
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image, CompressedImage
from cv_bridge import CvBridge
import cv2
import websockets

connected_clients = set()

class DualImageToCompressedRelayNode(Node):
    def __init__(self, loop):
        super().__init__('dual_image_to_compressed_relay_node')
        self.loop = loop
        self.bridge = CvBridge()

        self.left_subscription = self.create_subscription(
            Image,
            '/camera/camera/infra1/image_rect_raw',
            self.left_callback,
            10
        )
        self.left_publisher = self.create_publisher(
            CompressedImage,
            '/stereo/left/rectified_images/compressed',
            10
        )

        self.right_subscription = self.create_subscription(
            Image,
            '/camera/camera/infra2/image_rect_raw',
            self.right_callback,
            10
        )
        self.right_publisher = self.create_publisher(
            CompressedImage,
            '/stereo/right/rectified_images/compressed',
            10
        )

    def compress_and_publish(self, msg: Image, publisher, label: str, prefix_char: bytes):
        try:
            cv_image = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
            ret, jpeg_buffer = cv2.imencode('.jpg', cv_image, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ret:
                self.get_logger().warning(f"{label}: JPEG compression failed")
                return

            jpeg_bytes = jpeg_buffer.tobytes()

            # Publish to /compressed topic
            compressed_msg = CompressedImage()
            compressed_msg.header = msg.header
            compressed_msg.format = 'jpeg'
            compressed_msg.data = jpeg_bytes
            publisher.publish(compressed_msg)

            # Prefix and send to all WebSocket clients
            full_payload = prefix_char + jpeg_bytes  # e.g., b'L' + bytes(...)
            for client in connected_clients.copy():
                asyncio.run_coroutine_threadsafe(client.send(full_payload), self.loop)

        except Exception as e:
            self.get_logger().error(f"{label} error: {e}")

    def left_callback(self, msg: Image):
        self.compress_and_publish(msg, self.left_publisher, "LEFT", b'L')

    def right_callback(self, msg: Image):
        self.compress_and_publish(msg, self.right_publisher, "RIGHT", b'R')


async def websocket_handler(websocket, path):
    connected_clients.add(websocket)
    print("🔌 Client connected")
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)
        print("❌ Client disconnected")

async def main_async():
    loop = asyncio.get_running_loop()

    server = await websockets.serve(websocket_handler, "0.0.0.0", 8765)
    print("🌐 WebSocket server started on ws://0.0.0.0:8765")

    rclpy.init()
    node = DualImageToCompressedRelayNode(loop)

    try:
        await asyncio.gather(
            server.wait_closed(),
            loop.run_in_executor(None, rclpy.spin, node)
        )
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == "__main__":
    asyncio.run(main_async())
