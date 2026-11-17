// Plain-swiftc check for Inbox (no XCTest target): swiftc Shared/Inbox.swift InboxCheck/main.swift -o /tmp/inbox-check && /tmp/inbox-check
import Foundation

let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try! FileManager.default.createDirectory(at: tmp.appendingPathComponent("lore"), withIntermediateDirectories: true)
try! Data().write(to: tmp.appendingPathComponent("a.jpg"))
try! Data().write(to: tmp.appendingPathComponent("lore/b.json"))
precondition(Inbox.files(in: tmp).map(\.lastPathComponent) == ["a.jpg"], "pending() must skip the lore/ folder")
precondition(Inbox.loreName("World.json") == "World", "drops the .json suffix")
precondition(Inbox.loreName("my.json.notes.JSON") == "my.json.notes", "only the suffix, any case")
precondition(Inbox.loreName("a/b") == "a-b", "no path separators")
try? FileManager.default.removeItem(at: tmp)
print("inbox-check OK")
