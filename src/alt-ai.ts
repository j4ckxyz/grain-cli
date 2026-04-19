import type { AltAiConfig } from "./types";
import { GrainError } from "./errors";

type OpenAiCompatibleResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
            content?: string;
          }>;
      reasoning?: string;
      reasoning_details?: Array<{
        type?: string;
        summary?: string;
        text?: string | null;
      }>;
    };
  }>;
};

function sanitizeAltText(text: string): string {
  const normalized = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= 220) {
    return normalized;
  }

  return normalized.slice(0, 220).trimEnd();
}

function trimToWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }

  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 40) {
    return slice.slice(0, lastSpace).trimEnd();
  }
  return slice.trimEnd();
}

function buildPrompt(): string {
  return [
    "You are an expert accessibility and image metadata writer.",
    "Write one single-line alt text description for one image.",
    "Output only the final alt text.",
    "Goals in strict priority:",
    "1) Screen reader quality: clear, specific, truthful, natural language.",
    "2) Search discoverability: include concrete nouns and context that a user would search for.",
    "3) OCR utility: include legible visible text from the image if present.",
    "Hard rules:",
    "- 90 to 180 characters preferred, hard max 220 characters.",
    "- Plain ASCII only.",
    "- No emojis, no decorative symbols, no unusual punctuation.",
    "- No keyword stuffing.",
    "- No leading phrases like 'Image of' or 'Photo of' unless needed for clarity.",
    "- If text is visible in the image, quote key words exactly once.",
    "- Mention important entities: people, objects, location context, action, mood, and notable colors only when useful.",
    "- Keep it concise and readable aloud in one breath.",
  ].join("\n");
}

function extractMessageTextContent(
  content:
    | string
    | Array<{
        type?: string;
        text?: string;
        content?: string;
      }>
    | undefined,
): string | undefined {
  if (typeof content === "string") {
    const text = content.trim();
    return text || undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const merged = content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if (typeof part.text === "string") {
        return part.text;
      }
      if (typeof part.content === "string") {
        return part.content;
      }
      return "";
    })
    .join(" ")
    .trim();

  return merged || undefined;
}

function buildReasoningPayload(config: AltAiConfig): { effort: string; exclude: boolean } {
  if (config.reasoningEffort && config.reasoningEffort !== "none") {
    return {
      effort: config.reasoningEffort,
      exclude: config.showReasoning === true ? false : true,
    };
  }

  return {
    effort: "none",
    exclude: true,
  };
}

async function requestAltCompletion(input: {
  config: AltAiConfig;
  prompt: string;
  imageDataUrl: string;
  reasoning: { effort: string; exclude: boolean };
}): Promise<OpenAiCompatibleResponse> {
  const endpoint = input.config.endpoint.replace(/\/$/, "");
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 90_000);
  if (typeof timeout === "object" && timeout !== null && "unref" in timeout) {
    const maybeTimer = timeout as { unref?: () => void };
    maybeTimer.unref?.();
  }

  try {
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.config.model,
        messages: [
          {
            role: "system",
            content: input.prompt,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Create the highest quality alt text for this image.",
              },
              {
                type: "image_url",
                image_url: {
                  url: input.imageDataUrl,
                },
              },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 400,
        reasoning: input.reasoning,
      }),
      signal: timeoutController.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new GrainError("alt_ai_request_failed", `Alt-text API request failed (${response.status}): ${text}`);
    }

    return JSON.parse(text) as OpenAiCompatibleResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GrainError("alt_ai_timeout", "Alt-text API request timed out.", "Try a faster model or reduce reasoning effort.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateAltTextFromImage(
  config: AltAiConfig,
  imageBytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const base64 = Buffer.from(imageBytes).toString("base64");
  const imageDataUrl = `data:${mimeType};base64,${base64}`;
  const prompt = buildPrompt();
  const firstResponse = await requestAltCompletion({
    config,
    prompt,
    imageDataUrl,
    reasoning: buildReasoningPayload(config),
  });

  if (config.showReasoning) {
    const msg = firstResponse.choices?.[0]?.message;
    const reasoning = msg?.reasoning?.trim();
    const details = msg?.reasoning_details ?? [];
    const summary = details
      .map((item) => item.summary ?? item.text ?? "")
      .find((value) => value.trim().length > 0);

    const snippet = reasoning || summary;
    if (snippet) {
      console.log(`AI reasoning: ${trimToWordBoundary(sanitizeAltText(snippet), 180)}`);
    } else {
      console.log("AI reasoning: not returned by this model/provider.");
    }
  }

  let raw = extractMessageTextContent(firstResponse.choices?.[0]?.message?.content);
  if (!raw && config.reasoningEffort && config.reasoningEffort !== "none") {
    const retryResponse = await requestAltCompletion({
      config,
      prompt,
      imageDataUrl,
      reasoning: {
        effort: "none",
        exclude: true,
      },
    });
    raw = extractMessageTextContent(retryResponse.choices?.[0]?.message?.content);
    if (!raw) {
      const finishReason = retryResponse.choices?.[0]?.finish_reason;
      throw new GrainError(
        "alt_ai_empty_response",
        finishReason
          ? `Alt-text API returned an empty response (finish reason: ${finishReason}).`
          : "Alt-text API returned an empty response.",
      );
    }
  }

  if (!raw) {
    throw new GrainError("alt_ai_empty_response", "Alt-text API returned an empty response.");
  }

  const sanitized = sanitizeAltText(raw);
  if (!sanitized) {
    throw new GrainError("alt_ai_sanitized_empty", "Alt-text API response was empty after sanitization.");
  }

  return sanitized;
}

export function sanitizeGeneratedAltText(text: string): string {
  const cleaned = sanitizeAltText(text);
  return trimToWordBoundary(cleaned, 220);
}
