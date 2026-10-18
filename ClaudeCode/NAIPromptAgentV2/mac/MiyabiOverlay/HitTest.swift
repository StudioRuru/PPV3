import CoreGraphics

enum HitTest {
    /// Alpha (0...1) of the pixel at `p`, in image pixels from the top-left; 0 out of bounds.
    static func alphaAt(_ image: CGImage, _ p: CGPoint) -> CGFloat {
        let x = Int(p.x.rounded(.down)), y = Int(p.y.rounded(.down))
        guard p.x >= 0, p.y >= 0, x < image.width, y < image.height else { return 0 }
        var a: UInt8 = 0
        guard let ctx = CGContext(data: &a, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 1, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue) else { return 0 }
        ctx.draw(image, in: CGRect(x: -x, y: -(image.height - y - 1), width: image.width, height: image.height))
        return CGFloat(a) / 255
    }
}
