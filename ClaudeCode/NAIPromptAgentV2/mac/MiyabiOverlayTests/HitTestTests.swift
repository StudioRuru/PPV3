import CoreGraphics
import XCTest

final class HitTestTests: XCTestCase {
    /// 4x4 image, transparent except an opaque pixel at (x: 1, y: 2) counted from the top-left.
    private func image() -> CGImage {
        var px = [UInt8](repeating: 0, count: 4 * 4 * 4)
        let i = (2 * 4 + 1) * 4
        px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255
        let ctx = CGContext(data: &px, width: 4, height: 4, bitsPerComponent: 8, bytesPerRow: 16, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        return ctx.makeImage()!
    }

    func testOpaqueAndTransparent() {
        let img = image()
        XCTAssertEqual(HitTest.alphaAt(img, CGPoint(x: 1, y: 2)), 1, accuracy: 0.01)
        XCTAssertEqual(HitTest.alphaAt(img, CGPoint(x: 0, y: 0)), 0)
        XCTAssertEqual(HitTest.alphaAt(img, CGPoint(x: 2, y: 2)), 0)
    }

    func testOutOfBounds() {
        let img = image()
        for p in [CGPoint(x: -1, y: 0), CGPoint(x: 4, y: 0), CGPoint(x: 0, y: 4), CGPoint(x: 0, y: -0.5)] {
            XCTAssertEqual(HitTest.alphaAt(img, p), 0)
        }
    }
}
