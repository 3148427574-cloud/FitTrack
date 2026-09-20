// 读 Mac 版真实的 fittrack.json，按 AppStore.save() 的编码配置重新写一遍到 stdout。
// 目的：和网页版 `encodeJSON(decodeJSON(raw))` 的输出逐字节比对，验证
//   - 排序键（sortedKeys）
//   - nil optional 整个键不写（encodeIfPresent）
//   - 日期是秒精度 ISO8601
// 这三条规则在网页版是否真的对齐。
//
// 用手动跑，不进 vitest —— 它依赖本机真实用户数据，不该进仓库。
//
// 编译运行：
//   swiftc -O -o /tmp/ftroundtrip ../../Sources/FitTrack/Models.swift roundtrip.swift
//   /tmp/ftroundtrip ~/Library/Application\ Support/FitTrack/fittrack.json > /tmp/ft_expected.json

import Foundation

let path = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : NSHomeDirectory() + "/Library/Application Support/FitTrack/fittrack.json"

guard let raw = try? Data(contentsOf: URL(fileURLWithPath: path)) else {
    FileHandle.standardError.write("读不到 \(path)\n".data(using: .utf8)!)
    exit(1)
}

let dec = JSONDecoder()
dec.dateDecodingStrategy = .iso8601
guard let data = try? dec.decode(AppData.self, from: raw) else {
    FileHandle.standardError.write("解码失败\n".data(using: .utf8)!)
    exit(1)
}

let enc = JSONEncoder()
enc.dateEncodingStrategy = .iso8601
enc.outputFormatting = [.prettyPrinted, .sortedKeys]
guard let out = try? enc.encode(data) else {
    FileHandle.standardError.write("编码失败\n".data(using: .utf8)!)
    exit(1)
}
FileHandle.standardOutput.write(out)
