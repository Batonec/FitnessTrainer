import SwiftUI

@main
struct TrainerIOSApp: App {
    @StateObject private var store = TrainerStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .task {
                    await store.boot()
                }
        }
    }
}
