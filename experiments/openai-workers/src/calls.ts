import { createOpenAI, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { generateText, Output, stepCountIs, tool } from "ai";
import {
  FIXTURE_CODE,
  fixtureInputSchema,
  fixtureOutputSchema,
  labelSchema,
} from "./schemas";

export const responseProviderOptions = {
  openai: {
    reasoningEffort: "low",
    store: false,
  } satisfies OpenAILanguageModelResponsesOptions,
};

export function configuredApiKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  if (key === undefined || key === "" || key === "replace-me") return undefined;
  return key;
}

function responsesModel(apiKey: string, fetchImpl: typeof fetch | undefined) {
  return createOpenAI({ apiKey, fetch: fetchImpl }).responses("gpt-6.1-sol");
}

export async function lookupFixture(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
  maxRetries?: number;
}): Promise<{
  text: string;
  executed: number;
  toolInputs: unknown[];
  toolOutputs: unknown[];
  steps: number;
  usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
    reasoningTokens: number | undefined;
  };
}> {
  let executed = 0;
  const result = await generateText({
    model: responsesModel(options.apiKey, options.fetchImpl),
    maxRetries: options.maxRetries ?? 1,
    abortSignal: options.abortSignal,
    providerOptions: responseProviderOptions,
    stopWhen: stepCountIs(2),
    prepareStep: ({ stepNumber }) => ({
      toolChoice:
        stepNumber === 0
          ? { type: "tool", toolName: "lookupFixtureCode" }
          : "none",
    }),
    tools: {
      lookupFixtureCode: tool({
        description: "Return the fictional code for one known fixture id.",
        inputSchema: fixtureInputSchema,
        execute: (input) => {
          const parsed = fixtureInputSchema.parse(input);
          executed += 1;
          if (parsed.fixtureId !== "desk-lamp") {
            throw new Error("fixture id failed validation");
          }
          return fixtureOutputSchema.parse({ code: FIXTURE_CODE });
        },
      }),
    },
    prompt:
      "Look up fixtureId desk-lamp with lookupFixtureCode. After the tool returns, reply with only the code from the tool result.",
  });

  return {
    text: result.text,
    executed,
    toolInputs: result.toolCalls.map((call) => call.input),
    toolOutputs: result.toolResults.map((call) => call.output),
    steps: result.steps.length,
    usage: {
      inputTokens: result.totalUsage.inputTokens,
      outputTokens: result.totalUsage.outputTokens,
      totalTokens: result.totalUsage.totalTokens,
      reasoningTokens: result.totalUsage.outputTokenDetails.reasoningTokens,
    },
  };
}

export async function labelObject(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
  maxRetries?: number;
}): Promise<{
  output: unknown;
  usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
    reasoningTokens: number | undefined;
  };
}> {
  const result = await generateText({
    model: responsesModel(options.apiKey, options.fetchImpl),
    maxRetries: options.maxRetries ?? 1,
    abortSignal: options.abortSignal,
    providerOptions: responseProviderOptions,
    output: Output.object({ schema: labelSchema }),
    prompt: 'Return an object with label "sol-check" and count 2.',
  });
  return {
    output: result.output,
    usage: {
      inputTokens: result.totalUsage.inputTokens,
      outputTokens: result.totalUsage.outputTokens,
      totalTokens: result.totalUsage.totalTokens,
      reasoningTokens: result.totalUsage.outputTokenDetails.reasoningTokens,
    },
  };
}
