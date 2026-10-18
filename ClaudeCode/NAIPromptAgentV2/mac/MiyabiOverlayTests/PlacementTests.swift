import CoreGraphics
import XCTest

final class PlacementTests: XCTestCase {
    func testBottomRightAboveDock() {
        let screen = CGRect(x: 0, y: 0, width: 1920, height: 1080)
        let visible = CGRect(x: 0, y: 70, width: 1920, height: 985) // dock at the bottom
        let size = CGSize(width: 240, height: 416)
        let p = Placement.home(screen: screen, visible: visible, size: size)
        XCTAssertEqual(p.x, 1920 - 240 - 24)
        XCTAssertEqual(p.y, 70 + 24)
        XCTAssertTrue(visible.contains(CGRect(origin: p, size: size)))
    }

    func testOffsetScreenAndOversizedWindowStayInside() {
        let screen = CGRect(x: -1440, y: 100, width: 1440, height: 900)
        let visible = CGRect(x: -1440, y: 100, width: 1440, height: 875)
        let p = Placement.home(screen: screen, visible: visible, size: CGSize(width: 240, height: 416))
        XCTAssertTrue(visible.contains(CGRect(origin: p, size: CGSize(width: 240, height: 416))))
        let tiny = CGRect(x: 0, y: 0, width: 200, height: 300)
        let q = Placement.home(screen: tiny, visible: tiny, size: CGSize(width: 240, height: 416))
        XCTAssertGreaterThanOrEqual(q.x, tiny.minX)
        XCTAssertGreaterThanOrEqual(q.y, tiny.minY)
    }
}
