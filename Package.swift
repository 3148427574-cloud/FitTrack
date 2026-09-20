// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FitTrack",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "FitTrack",
            path: "Sources/FitTrack"
        )
    ]
)
