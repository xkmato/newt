import { GoogleGenAI } from "@google/genai";
import type {
  LlmGenerateJsonRequest,
  LlmGenerateJsonResponse,
  LlmProvider,
} from "./types.js";

function extractJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;
  return JSON.parse(candidate);
}

/**
 * Default Newt LLM provider backed by Google Gemini (`@google/genai`).
 * Uses structured JSON output (`responseMimeType: "application/json"`).
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly providerName = "gemini";
  readonly modelName: string;
  private readonly client: GoogleGenAI;

  constructor(options: { apiKey: string; model?: string }) {
    this.modelName = options.model ?? "gemini-2.5-flash";
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
  }

  async generateJson<T = unknown>(
    req: LlmGenerateJsonRequest
  ): Promise<LlmGenerateJsonResponse<T>> {
    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: req.userPrompt,
      config: {
        systemInstruction: req.systemPrompt,
        temperature: req.temperature ?? 0.2,
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "";
    const parsed = extractJsonObject(text) as T;
    const meta = response.usageMetadata;

    return {
      data: parsed,
      usage: {
        provider: this.providerName,
        model: this.modelName,
        inputTokens: meta?.promptTokenCount ?? 0,
        outputTokens: meta?.candidatesTokenCount ?? 0,
      },
    };
  }
}

/**
 * Anthropic Claude provider via Messages API (`fetch`, zero extra deps).
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly providerName = "anthropic";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; model?: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.modelName = options.model ?? "claude-sonnet-4-20250514";
    this.baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  }

  async generateJson<T = unknown>(
    req: LlmGenerateJsonRequest
  ): Promise<LlmGenerateJsonResponse<T>> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: 8192,
        temperature: req.temperature ?? 0.2,
        system: `${req.systemPrompt}\n\nRespond ONLY with valid raw JSON matching the requested schema.`,
        messages: [{ role: "user", content: req.userPrompt }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";

    return {
      data: extractJsonObject(text) as T,
      usage: {
        provider: this.providerName,
        model: this.modelName,
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
    };
  }
}

/**
 * OpenAI-compatible provider supporting OpenAI, Ollama (`http://127.0.0.1:11434/v1`),
 * vLLM, and OpenRouter.
 */
export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly providerName: string;
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    providerName?: string;
  }) {
    this.providerName = options.providerName ?? "openai";
    this.apiKey = options.apiKey;
    this.modelName = options.model ?? "gpt-4o-mini";
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  }

  async generateJson<T = unknown>(
    req: LlmGenerateJsonRequest
  ): Promise<LlmGenerateJsonResponse<T>> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        temperature: req.temperature ?? 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`${this.providerName} API error (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";

    return {
      data: extractJsonObject(text) as T,
      usage: {
        provider: this.providerName,
        model: this.modelName,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/**
 * Resolves the configured LLM provider from environment variables.
 * Defaults to **Google Gemini** (`NEWT-DECISION-001`) unless overridden by `NEWT_LLM_PROVIDER`.
 */
export function createLlmProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): LlmProvider {
  const selected = (env.NEWT_LLM_PROVIDER ?? "gemini").toLowerCase();

  if (selected === "gemini") {
    const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing GEMINI_API_KEY (or GOOGLE_API_KEY). Set it to run Newt's default Gemini agent engine."
      );
    }
    return new GeminiLlmProvider({
      apiKey,
      model: env.NEWT_GEMINI_MODEL ?? "gemini-2.5-flash",
    });
  }

  if (selected === "anthropic") {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY for NEWT_LLM_PROVIDER=anthropic");
    return new AnthropicLlmProvider({
      apiKey,
      model: env.NEWT_ANTHROPIC_MODEL,
    });
  }

  if (selected === "ollama") {
    return new OpenAiCompatibleLlmProvider({
      providerName: "ollama",
      apiKey: env.OLLAMA_API_KEY ?? "ollama",
      baseUrl: env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
      model: env.NEWT_OLLAMA_MODEL ?? "qwen2.5-coder:14b",
    });
  }

  if (selected === "openai") {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY for NEWT_LLM_PROVIDER=openai");
    return new OpenAiCompatibleLlmProvider({
      providerName: "openai",
      apiKey,
      baseUrl: env.OPENAI_BASE_URL,
      model: env.NEWT_OPENAI_MODEL,
    });
  }

  throw new Error(`Unsupported NEWT_LLM_PROVIDER '${selected}'`);
}
