import Foundation
import FoundationModels

struct Input: Decodable {
    let text: String
    let chapterTitle: String
}

struct Output: Encodable {
    let summary: String?
    let chunkCount: Int?
    let error: String?
}

func writeOutput(_ output: Output) {
    if let data = try? JSONEncoder().encode(output) {
        FileHandle.standardOutput.write(data)
    }
}

func chunkWords(_ text: String, size: Int) -> [String] {
    let words = text.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
    var chunks: [String] = []
    var i = 0
    while i < words.count {
        let end = min(i + size, words.count)
        chunks.append(words[i..<end].joined(separator: " "))
        i = end
    }
    return chunks
}

func summarize(text: String, chapterTitle: String) async throws -> (String, Int) {
    let chunks = chunkWords(text, size: 500)

    if chunks.count == 1 {
        let session = LanguageModelSession(
            instructions: "You are a reading assistant. Write concise, spoiler-free summaries of book passages."
        )
        let heading = chapterTitle.isEmpty ? "" : "Chapter: \(chapterTitle)\n\n"
        let response = try await session.respond(
            to: "\(heading)Summarize the key events and ideas from this passage in 3-5 sentences:\n\n\(chunks[0])"
        )
        return (response.content, 1)
    }

    // Phase 1: summarize each chunk individually.
    var intermediates: [String] = []
    for (i, chunk) in chunks.enumerated() {
        let session = LanguageModelSession(
            instructions: "You are a reading assistant. Write concise, spoiler-free passage summaries."
        )
        let response = try await session.respond(
            to: "Summarize this passage in 2 sentences (part \(i + 1) of \(chunks.count)):\n\n\(chunk)"
        )
        intermediates.append(response.content)
    }

    // Phase 2: synthesize intermediate summaries.
    let combined = intermediates.enumerated()
        .map { "\($0.offset + 1). \($0.element)" }
        .joined(separator: "\n\n")
    let finalSession = LanguageModelSession(
        instructions: "You are a reading assistant. Synthesize passage summaries into cohesive chapter overviews."
    )
    let heading = chapterTitle.isEmpty ? "" : "Chapter: \(chapterTitle)\n\n"
    let finalResponse = try await finalSession.respond(
        to: "\(heading)Synthesize these \(chunks.count) passage summaries into a cohesive 4-5 sentence chapter summary:\n\n\(combined)"
    )
    return (finalResponse.content, chunks.count)
}

Task {
    let inputData = FileHandle.standardInput.readDataToEndOfFile()
    guard let input = try? JSONDecoder().decode(Input.self, from: inputData) else {
        writeOutput(Output(summary: nil, chunkCount: nil, error: "Invalid input JSON"))
        exit(1)
    }

    let availability = SystemLanguageModel.default.availability
    guard case .available = availability else {
        writeOutput(Output(
            summary: nil,
            chunkCount: nil,
            error: "Apple Intelligence is not available. Enable it in System Settings → Apple Intelligence & Siri."
        ))
        exit(1)
    }

    do {
        let (summary, chunkCount) = try await summarize(text: input.text, chapterTitle: input.chapterTitle)
        writeOutput(Output(summary: summary, chunkCount: chunkCount, error: nil))
        exit(0)
    } catch {
        writeOutput(Output(summary: nil, chunkCount: nil, error: error.localizedDescription))
        exit(1)
    }
}

RunLoop.main.run()
