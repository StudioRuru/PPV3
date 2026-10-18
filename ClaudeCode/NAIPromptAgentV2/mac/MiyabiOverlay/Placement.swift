import CoreGraphics

enum Placement {
    static let margin: CGFloat = 24
    /// Bottom-right corner just above the Dock (visibleFrame bottom), clamped inside the visible frame.
    static func home(screen: CGRect, visible: CGRect, size: CGSize) -> CGPoint {
        let area = visible.intersection(screen)
        let box = area.isNull ? visible : area
        return CGPoint(x: max(box.minX, box.maxX - size.width - margin), y: max(box.minY, min(box.minY + margin, box.maxY - size.height)))
    }
}
