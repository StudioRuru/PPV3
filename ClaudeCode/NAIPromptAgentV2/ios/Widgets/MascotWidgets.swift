import ActivityKit
import SwiftUI
import WidgetKit

/// Miyabi on the Lock Screen and in the Dynamic Island. Reads only the app-group bust; no network.
@main
struct MascotWidgetBundle: WidgetBundle {
    var body: some Widget { MascotLiveActivity() }
}

private let accent = Color(red: 0xb7 / 255, green: 0xa4 / 255, blue: 0xff / 255)
private let night = Color(red: 0x0d / 255, green: 0x10 / 255, blue: 0x20 / 255)

struct MascotLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MascotAttributes.self) { ctx in
            let s = ctx.state
            HStack(spacing: 12) {
                Bust(state: s, size: 52)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Miyabi").font(.headline).foregroundStyle(accent)
                    Text(s.tabLabel).font(.subheadline).foregroundStyle(.white)
                    Text(s.expression).font(.caption).foregroundStyle(.white.opacity(0.6))
                }
                Spacer()
                ToggleButton(hidden: s.hidden)
            }
            .padding(14)
            .activityBackgroundTint(night)
            .activitySystemActionForegroundColor(accent)
            .widgetURL(tabURL(s.tab))
        } dynamicIsland: { ctx in
            let s = ctx.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Bust(state: s, size: 44) }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(s.tabLabel).font(.caption).foregroundStyle(accent).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        ToggleButton(hidden: s.hidden)
                        Spacer()
                        Link("Studio", destination: tabURL("studio"))
                        Link("Chat", destination: tabURL("chat"))
                    }
                    .font(.caption).tint(accent)
                }
            } compactLeading: {
                Bust(state: s, size: 24)
            } compactTrailing: {
                Text(s.tabLabel).font(.caption2).foregroundStyle(accent).lineLimit(1)
            } minimal: {
                Bust(state: s, size: 24)
            }
            .keylineTint(accent)
            .widgetURL(tabURL(s.tab))
        }
    }
}

private func tabURL(_ tab: String) -> URL {
    URL(string: "naistudio://tab/\(Mascot.validTabs.contains(tab) ? tab : "studio")")!
}

private struct ToggleButton: View {
    let hidden: Bool
    var body: some View {
        if hidden { Button("Summon", intent: SummonMiyabiIntent()).tint(accent) }
        else { Button("Hide", intent: HideMiyabiIntent()).tint(accent) }
    }
}

/// The ≤120 px bust from the app group; re-read every render (`imageVersion` changes force one).
private struct Bust: View {
    let state: MascotAttributes.ContentState
    let size: CGFloat
    var body: some View {
        let img = AppGroup.moodImageURL.flatMap { UIImage(contentsOfFile: $0.path) }
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let img { Image(uiImage: img).resizable().scaledToFill() }
                else { Image(systemName: "face.smiling").resizable().scaledToFit().foregroundStyle(accent).padding(size * 0.1) }
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
            .opacity(state.hidden ? 0.4 : 1)
            if state.hidden && size >= 40 {
                Image(systemName: "eye.slash").font(.system(size: size * 0.3)).foregroundStyle(.white)
            }
        }
        .id(state.imageVersion)
    }
}
